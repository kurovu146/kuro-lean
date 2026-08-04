import { closeSync, openSync, readSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { CACHE_WRITE_MULT, priceOf, type PricingTable } from "./cost";
import { fmtIdle } from "./statusline";

/**
 * Tra phiên bỏ dở trên TOÀN MÁY. `kt handoff --recover` bám theo cwd, nên chỉ dùng được khi
 * đã biết phiên nằm ở repo nào — mà quên handoff thì thường quên luôn cả điều đó.
 *
 * 1.901 transcript / 900MB trên máy thật: không được đọc cả file. stat() lọc trước, chỉ đọc
 * vài KB đầu (cwd/branch) và cuối (usage) của số ít file lọt vào danh sách.
 */

const HEAD_BYTES = 16_000;
const TAIL_BYTES = 64_000;

export interface SessionRow {
  path: string;
  cwd: string;
  branch: string;
  idleMinutes: number;
  tokens: number;
  model: string;
  bytes: number;
}

export interface ListOptions {
  /** Dưới ngưỡng này coi như phiên chưa có gì để cứu. */
  minBytes: number;
  limit: number;
  now?: number;
}

/** Đọc một lát byte ở đầu hoặc cuối file, không nạp cả file vào RAM. */
function readSlice(path: string, bytes: number, from: "head" | "tail"): string {
  let fd: number | null = null;
  try {
    const size = statSync(path).size;
    const len = Math.min(bytes, size);
    const pos = from === "head" ? 0 : size - len;
    fd = openSync(path, "r");
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, pos);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== null) try { closeSync(fd); } catch {}
  }
}

/** cwd/gitBranch nằm rải trong transcript; lấy lần xuất hiện đầu tiên ở đầu file. */
export function readMeta(path: string): { cwd: string; branch: string } {
  const head = readSlice(path, HEAD_BYTES, "head");
  return {
    cwd: /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1] ?? "",
    branch: /"gitBranch":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1] ?? "",
  };
}

/** Usage của lượt CUỐI = kích thước context phải nạp lại. Đọc ngược từ đuôi file. */
export function readLastUsage(path: string): { tokens: number; model: string } {
  const lines = readSlice(path, TAIL_BYTES, "tail").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // lát cắt có thể chặt giữa dòng đầu tiên — bỏ qua là đúng
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

export function listSessions(root: string, opts: ListOptions): SessionRow[] {
  const now = opts.now ?? Date.now();
  const found: { path: string; mtime: number; bytes: number }[] = [];

  let dirs: string[];
  try {
    dirs = readdirSync(root);
  } catch {
    return [];
  }
  for (const d of dirs) {
    const dir = join(root, d);
    let files: string[];
    try {
      if (!statSync(dir).isDirectory()) continue;
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(dir, f);
      try {
        const st = statSync(p);
        if (st.size < opts.minBytes) continue;
        found.push({ path: p, mtime: st.mtimeMs, bytes: st.size });
      } catch {}
    }
  }

  found.sort((a, b) => b.mtime - a.mtime);
  return found.slice(0, opts.limit).map((r) => {
    const { cwd, branch } = readMeta(r.path);
    const { tokens, model } = readLastUsage(r.path);
    return {
      path: r.path,
      cwd,
      branch,
      idleMinutes: Math.max(0, (now - r.mtime) / 60_000),
      tokens,
      model,
      bytes: r.bytes,
    };
  });
}

/** Bảng để mắt người quét nhanh: cột nào đắt nhất, phiên nào đáng cứu. */
export function renderSessions(rows: SessionRow[], pricing: PricingTable, home: string = homedir()): string {
  if (!rows.length) return "Không tìm thấy phiên nào đáng cứu.\n";
  const out = ["  #  im        context     nạp lại   phiên"];
  rows.forEach((r, i) => {
    const price = r.model ? priceOf(r.model, pricing) : null;
    const money = price ? `$${((r.tokens / 1e6) * price.input * CACHE_WRITE_MULT).toFixed(2)}` : "—";
    const where = r.cwd ? (r.cwd.startsWith(home) ? "~" + r.cwd.slice(home.length) : r.cwd) : r.path;
    // tokens 0 = không thấy usage ở đuôi file, KHÁC với "phiên rỗng" — đừng hiện 0k rồi bị bỏ qua
    const ctx = r.tokens ? `${Math.round(r.tokens / 1000)}k tok` : "? tok";
    out.push(
      `  ${String(i + 1).padEnd(2)} ${fmtIdle(r.idleMinutes).padEnd(9)} ` +
        `${ctx.padStart(9)}   ${money.padEnd(8)}  ` +
        `${where}${r.branch ? ` (${r.branch})` : ""}`,
    );
  });
  return out.join("\n") + "\n";
}

/** `--from`: số thứ tự trong bảng, hoặc thẳng đường dẫn. null = không hiểu → đừng đoán. */
export function resolveFrom(rows: SessionRow[], arg: string): string | null {
  const s = arg.trim();
  if (/^\d+$/.test(s)) {
    const i = Number(s) - 1;
    return rows[i]?.path ?? null;
  }
  return s.includes("/") ? s : null;
}

export type HandoffArgs =
  | { mode: "prompt"; file: string; copy: boolean }
  | { mode: "list"; limit: number }
  | { mode: "recover"; n: number; from: string | null; copy: boolean };

/** Đọc cờ của `kt handoff`. Tách rời khỏi I/O để test được mà không cần dựng CLI. */
export function parseHandoffArgs(rest: string[]): HandoffArgs {
  const copy = rest.includes("--copy");
  const args = rest.filter((a) => a !== "--copy"); // lọc trước, kẻo thành tên file
  if (args[0] === "--list") return { mode: "list", limit: Number(args[1]) || 10 };
  if (args[0] === "--recover") {
    const tail = args.slice(1);
    const i = tail.indexOf("--from");
    const from = i >= 0 ? tail[i + 1] ?? null : null;
    // Bỏ cả cặp `--from X` rồi mới tìm N, kẻo `--from 2` bị đọc thành "2 message cuối".
    const nums = tail.filter((_, k) => i < 0 || (k !== i && k !== i + 1)).filter((a) => /^\d+$/.test(a));
    return { mode: "recover", n: Number(nums[0]) || 60, from, copy };
  }
  return { mode: "prompt", file: args[0] || ".kt/handoff.md", copy };
}

/** Lệnh clipboard theo hệ điều hành. null = không biết → nói thẳng, đừng nuốt im lặng. */
export function clipboardCommand(platform: string): { cmd: string; args: string[] } | null {
  if (platform === "darwin") return { cmd: "pbcopy", args: [] };
  if (platform === "win32") return { cmd: "clip", args: [] };
  if (platform === "linux") return { cmd: "xclip", args: ["-selection", "clipboard"] };
  return null;
}
