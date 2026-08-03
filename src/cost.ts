import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/** Giá USD trên 1 TRIỆU token. */
export interface Price {
  input: number;
  output: number;
}
/** key = tiền tố model id (khớp dài nhất trước) → giá. */
export type PricingTable = Record<string, Price>;

export interface Usage {
  model: string;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

// Cache write = 2× giá input (TTL 1h; TTL 5 phút là 1.25×), cache read = 0.1×.
// Đây là chỗ tiền thật nằm: 1 token nạp vào bị tính 1 lần write + 1 lần read MỖI lượt sau đó.
export const CACHE_WRITE_MULT = 2;
export const CACHE_READ_MULT = 0.1;

/** Khớp model theo tiền tố, ưu tiên khớp dài nhất (id thật hay kèm hậu tố ngày). */
export function priceOf(model: string, table: PricingTable): Price | null {
  let best: [string, Price] | null = null;
  for (const [prefix, price] of Object.entries(table)) {
    if (model.startsWith(prefix) && (!best || prefix.length > best[0].length)) best = [prefix, price];
  }
  return best ? best[1] : null;
}

export interface Tally {
  cost: { input: number; cacheWrite: number; cacheRead: number; output: number };
  tokens: { input: number; cacheWrite: number; cacheRead: number; output: number };
  byModel: { model: string; cost: number; tokens: number }[];
  total: number;
  skipped: string[];
}

/** Quy usage ra tiền (PURE). Model ngoài bảng giá bị bỏ qua và liệt kê ở `skipped`. */
export function tallyUsage(rows: Usage[], table: PricingTable): Tally {
  const cost = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const tokens = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const byModel = new Map<string, { cost: number; tokens: number }>();
  const skipped = new Set<string>();

  for (const r of rows) {
    const p = priceOf(r.model, table);
    if (!p) {
      skipped.add(r.model);
      continue;
    }
    const c = {
      input: (r.input / 1e6) * p.input,
      cacheWrite: (r.cacheWrite / 1e6) * p.input * CACHE_WRITE_MULT,
      cacheRead: (r.cacheRead / 1e6) * p.input * CACHE_READ_MULT,
      output: (r.output / 1e6) * p.output,
    };
    for (const k of ["input", "cacheWrite", "cacheRead", "output"] as const) {
      cost[k] += c[k];
      tokens[k] += r[k];
    }
    const m = byModel.get(r.model) ?? { cost: 0, tokens: 0 };
    m.cost += c.input + c.cacheWrite + c.cacheRead + c.output;
    m.tokens += r.input + r.cacheWrite + r.cacheRead + r.output;
    byModel.set(r.model, m);
  }

  return {
    cost,
    tokens,
    byModel: [...byModel.entries()]
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.cost - a.cost),
    total: cost.input + cost.cacheWrite + cost.cacheRead + cost.output,
    skipped: [...skipped],
  };
}

function fmtTok(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

/**
 * Báo cáo chi phí (PURE). Xếp theo tiền giảm dần — mục đích là chỉ ra khoản nào
 * thực sự chiếm hoá đơn, thường là cache read/write chứ không phải output.
 */
export function renderCost(rows: Usage[], table: PricingTable): string {
  if (rows.length === 0) {
    return "(chưa có dữ liệu usage — cần vài phiên Claude Code trong project này trước đã)\n";
  }
  const t = tallyUsage(rows, table);
  if (t.total === 0) return "(chưa có usage tính được tiền — model không có trong bảng giá kt.json)\n";

  const kinds = [
    ["cache read ", t.cost.cacheRead, t.tokens.cacheRead, `${CACHE_READ_MULT}× input · context đọc lại MỖI lượt`],
    ["cache write", t.cost.cacheWrite, t.tokens.cacheWrite, `${CACHE_WRITE_MULT}× input · mỗi token nạp vào, 1 lần`],
    ["output     ", t.cost.output, t.tokens.output, "model tự viết ra"],
    ["fresh input", t.cost.input, t.tokens.input, "chưa vào cache"],
  ] as const;

  const lines = [`Chi phí quy từ usage thật · tổng ~$${t.total.toFixed(2)}`, ""];
  for (const [label, c, tok, note] of [...kinds].sort((a, b) => b[1] - a[1])) {
    const pct = Math.round((c / t.total) * 100);
    lines.push(`  ${label} ${`$${c.toFixed(2)}`.padStart(10)} ${`${pct}%`.padStart(4)} · ${fmtTok(tok).padStart(6)} tok · ${note}`);
  }
  lines.push("", "Theo model:");
  for (const m of t.byModel) {
    lines.push(`  ${`$${m.cost.toFixed(2)}`.padStart(10)} · ${fmtTok(m.tokens).padStart(6)} tok · ${m.model}`);
  }
  if (t.skipped.length) lines.push("", `(bỏ qua, chưa có giá: ${t.skipped.join(", ")})`);
  return lines.join("\n") + "\n";
}

/**
 * Chi phí đọc lại context cho MỖI lượt kế tiếp. Context càng phình thì mỗi lần
 * gõ Enter càng đắt — con số này làm điều đó nhìn thấy được. null nếu chưa có giá.
 */
export function perTurnCost(tokens: number, model: string, table: PricingTable): number | null {
  const p = priceOf(model, table);
  return p ? (tokens / 1e6) * p.input * CACHE_READ_MULT : null;
}

// ---- Thu thập từ transcript (không pure) ----

/** Thư mục transcript Claude Code của một cwd: /a/b → ~/.claude/projects/-a-b */
export function transcriptDir(cwd: string, home: string = homedir()): string {
  return join(home, ".claude", "projects", cwd.replace(/\//g, "-"));
}

function jsonlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 3) return;
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      try {
        if (statSync(p).isDirectory()) walk(p, depth + 1);
        else if (e.endsWith(".jsonl")) out.push(p);
      } catch {}
    }
  };
  walk(dir, 0);
  return out;
}

/** Đọc usage từ transcript (gồm cả subagent). Dòng hỏng/thiếu usage bị bỏ qua. */
export function collectUsage(dir: string): Usage[] {
  const rows: Usage[] = [];
  for (const f of jsonlFiles(dir)) {
    let text: string;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let e: any;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      const u = e?.message?.usage;
      if (!u || typeof u !== "object") continue;
      rows.push({
        model: e.message.model ?? "?",
        input: u.input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        output: u.output_tokens ?? 0,
      });
    }
  }
  return rows;
}
