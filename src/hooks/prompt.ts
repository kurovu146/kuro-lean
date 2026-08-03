import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import { CACHE_READ_MULT, CACHE_WRITE_MULT, priceOf, transcriptDir, type Price, type PricingTable } from "../cost";
import { fmtIdle } from "../statusline";
import { latestTranscript } from "../recover";

/**
 * Cảnh báo TRƯỚC khi request rời máy. Statusline chỉ vẽ lại SAU khi đã gửi, nên nó là
 * hoá đơn chứ không phải cảnh báo — lúc nhìn thấy "cache chết" thì tiền đã trả rồi.
 * UserPromptSubmit chạy trước, và `decision: "block"` huỷ luôn lượt đó => không tốn gì.
 */

export interface PromptFacts {
  idleMinutes: number;
  tokens: number;
  price: Price | null;
  alreadyWarned: boolean;
}

export interface PromptGuardConfig {
  idleMin: number;
  /** Dưới ngưỡng này nạp lại chỉ vài xu — chặn chỉ tổ phiền, không đáng. */
  minTokens: number;
}

/** Có nên chặn lượt này không (PURE). null = cho đi bình thường. */
export function decidePromptGuard(f: PromptFacts, cfg: PromptGuardConfig): { reason: string } | null {
  if (cfg.idleMin <= 0) return null; // tắt
  if (f.idleMinutes < cfg.idleMin) return null; // cache còn sống, gửi đi còn được gia hạn TTL
  if (f.alreadyWarned) return null; // đã cảnh báo cho đúng lần chết này → đừng chặn vòng lặp
  if (f.tokens < cfg.minTokens) return null;

  const tok = `${Math.round(f.tokens / 1000)}k token`;
  const money = f.price
    ? ` ở giá cache write (${CACHE_WRITE_MULT}× input) ≈ $${((f.tokens / 1e6) * f.price.input * CACHE_WRITE_MULT).toFixed(2)}` +
      `, và mỗi lượt sau đó ~$${((f.tokens / 1e6) * f.price.input * CACHE_READ_MULT).toFixed(2)} tiền đọc lại`
    : "";

  return {
    reason:
      `❄️ Cache context đã hết hạn — phiên im ${fmtIdle(f.idleMinutes)} (TTL ${cfg.idleMin} phút).\n` +
      `Gửi lượt này sẽ nạp lại toàn bộ ~${tok}${money}.\n\n` +
      `kt chặn ĐÚNG 1 LẦN để bạn chọn:\n` +
      `  • Vẫn tiếp phiên này → bấm ↑ rồi Enter (prompt còn trong lịch sử). Lượt sau không bị chặn nữa.\n` +
      `  • Rẻ hơn nhiều → /clear, rồi chạy \`kt handoff --recover\` và dán kết quả: mang lại phần việc đang dở với vài nghìn token.`,
  };
}

// ---- I/O ----

export interface LastContext {
  tokens: number;
  model: string;
}

/**
 * Usage của lượt CUỐI trong transcript = kích thước context đang phải nạp lại.
 * Cộng dồn cả phiên là sai: mỗi lượt đọc lại cùng một context, không phải context mới.
 */
export function lastContext(transcriptPath: string): LastContext {
  let text: string;
  try {
    text = readFileSync(transcriptPath, "utf8");
  } catch {
    return { tokens: 0, model: "" };
  }
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const u = e?.message?.usage;
    if (!u || typeof u !== "object") continue;
    return {
      tokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      model: e.message.model ?? "",
    };
  }
  return { tokens: 0, model: "" };
}

export function lastContextTokens(transcriptPath: string): number {
  return lastContext(transcriptPath).tokens;
}

/** Marker neo theo mtime: cùng một lần cache chết thì chỉ chặn một lần. */
export function markerPath(transcriptPath: string): string {
  const key = createHash("md5").update(transcriptPath).digest("hex").slice(0, 8);
  return join(tmpdir(), `kt-idle-${key}.json`);
}

export function hasWarned(statePath: string, mtime: number): boolean {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"))?.mtime === mtime;
  } catch {
    return false;
  }
}

export function markWarned(statePath: string, mtime: number): void {
  try {
    writeFileSync(statePath, JSON.stringify({ mtime }));
  } catch {}
}

export interface PromptHookInput {
  transcript_path?: string;
  cwd?: string;
}

/**
 * Cả hook: trả chuỗi JSON cho stdout, hoặc null nếu không can thiệp.
 * Transcript chỉ bị đọc khi mtime đã vượt ngưỡng — lượt bình thường chỉ tốn 1 lần stat().
 */
export function promptGuardOutput(
  input: PromptHookInput,
  cfg: { promptGuard: PromptGuardConfig; pricing: PricingTable },
  now: number = Date.now(),
): string | null {
  const { idleMin, minTokens } = cfg.promptGuard ?? { idleMin: 0, minTokens: 0 };
  if (idleMin <= 0) return null;

  let path = input.transcript_path;
  if (!path || !existsSync(path)) {
    path = latestTranscript(transcriptDir(input.cwd || process.cwd())) ?? undefined;
  }
  if (!path) return null;

  let mtime: number;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    return null;
  }
  const idleMinutes = Math.max(0, (now - mtime) / 60_000);
  if (idleMinutes < idleMin) return null; // đường thường thoát ở đây, chưa đọc byte nào

  const state = markerPath(path);
  const { tokens, model } = lastContext(path);
  const decision = decidePromptGuard(
    {
      idleMinutes,
      tokens,
      price: model ? priceOf(model, cfg.pricing) : null,
      alreadyWarned: hasWarned(state, mtime),
    },
    { idleMin, minTokens },
  );
  if (!decision) return null;

  markWarned(state, mtime);
  return JSON.stringify({ decision: "block", reason: decision.reason });
}

