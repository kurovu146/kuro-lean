import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/** Price in USD per 1 MILLION tokens. */
export interface Price {
  input: number;
  output: number;
}
/** key = a model-id prefix (longest match wins) → its price. */
export type PricingTable = Record<string, Price>;

export interface Usage {
  model: string;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

// Cache write = 2× the input price (1h TTL; the 5-minute TTL is 1.25×), cache read = 0.1×.
// This is where the money actually is: one token loaded is billed once as a write + once as a read on EVERY later turn.
export const CACHE_WRITE_MULT = 2;
export const CACHE_READ_MULT = 0.1;

/** Match a model by prefix, longest match first (real ids often carry a date suffix). */
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

/** Convert usage into money (PURE). Models absent from the price table are skipped and listed in `skipped`. */
export function tallyUsage(rows: Usage[], table: PricingTable): Tally {
  const cost = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const tokens = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const byModel = new Map<string, { cost: number; tokens: number }>();
  const skipped = new Set<string>();

  for (const r of rows) {
    const p = priceOf(r.model, table);
    if (!p) {
      // A row with zero tokens can't move the bill, so it can't represent a pricing gap either -
      // Claude Code's own bookkeeping pseudo-models (e.g. "<synthetic>" on an interrupted turn) log
      // exactly this shape, and flagging them forever would cry wolf on every real gap.
      if (r.input + r.cacheWrite + r.cacheRead + r.output > 0) skipped.add(r.model);
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

export function fmtTok(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

/**
 * The cost report (PURE). Sorted by money descending — the point is to show which line actually owns
 * the bill, which is usually cache read/write rather than output.
 */
export function renderCost(rows: Usage[], table: PricingTable): string {
  if (rows.length === 0) {
    return "(no usage data yet — this project needs a few Claude Code sessions first)\n";
  }
  const t = tallyUsage(rows, table);
  if (t.total === 0) return "(no priceable usage — the model isn't in the kt.json price table)\n";

  const kinds = [
    ["cache read ", t.cost.cacheRead, t.tokens.cacheRead, `${CACHE_READ_MULT}× input · the context re-read on EVERY turn`],
    ["cache write", t.cost.cacheWrite, t.tokens.cacheWrite, `${CACHE_WRITE_MULT}× input · once per token loaded`],
    ["output     ", t.cost.output, t.tokens.output, "what the model writes"],
    ["fresh input", t.cost.input, t.tokens.input, "not cached yet"],
  ] as const;

  const lines = [`Cost derived from real usage · total ~$${t.total.toFixed(2)}`, ""];
  for (const [label, c, tok, note] of [...kinds].sort((a, b) => b[1] - a[1])) {
    const pct = Math.round((c / t.total) * 100);
    lines.push(`  ${label} ${`$${c.toFixed(2)}`.padStart(10)} ${`${pct}%`.padStart(4)} · ${fmtTok(tok).padStart(6)} tok · ${note}`);
  }
  lines.push("", "By model:");
  for (const m of t.byModel) {
    lines.push(`  ${`$${m.cost.toFixed(2)}`.padStart(10)} · ${fmtTok(m.tokens).padStart(6)} tok · ${m.model}`);
  }
  if (t.skipped.length) lines.push("", `(skipped, no price: ${t.skipped.join(", ")})`);
  return lines.join("\n") + "\n";
}

/**
 * The cost of re-reading the context on EVERY following turn. A fatter context makes each Enter more
 * expensive — this number makes that visible. null when there is no price.
 */
export function perTurnCost(tokens: number, model: string, table: PricingTable): number | null {
  const p = priceOf(model, table);
  return p ? (tokens / 1e6) * p.input * CACHE_READ_MULT : null;
}

// ---- Collection from transcripts (not pure) ----

/** The Claude Code transcript directory for a cwd: /a/b → ~/.claude/projects/-a-b */
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

/**
 * Pull usage rows out of one transcript's text. `since` (epoch ms, 0 = no window) drops entries
 * stamped before the window; an entry with no timestamp is kept, because dropping real usage is a
 * worse error than counting one line early.
 */
function parseUsageInto(text: string, out: Usage[], since = 0): void {
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
    if (since && e.timestamp && Date.parse(e.timestamp) < since) continue;
    out.push({
      model: e.message.model ?? "?",
      input: u.input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      output: u.output_tokens ?? 0,
    });
  }
}

/** Read usage from the transcripts (including subagents). Corrupt lines and lines without usage are skipped. */
export function collectUsage(dir: string): Usage[] {
  const rows: Usage[] = [];
  for (const f of jsonlFiles(dir)) {
    try {
      parseUsageInto(readFileSync(f, "utf8"), rows);
    } catch {
      continue;
    }
  }
  return rows;
}

/**
 * A single transcript larger than this is skipped by the roll-up.
 *
 * Nothing here streams: a file is read whole and then split, so one pathological transcript becomes a
 * string twice its size plus a line array before a single row comes out — inside a detached process
 * nobody is watching. This is a heap guard against that one file, deliberately set above the real
 * range rather than tuned down: measured over 2,016 transcripts (1.12 GB) the median is 0.24 MB, p99
 * is 6.3 MB and the largest is 20.6 MB, so it does not fire in ordinary use.
 *
 * It is not free when it does fire — a skipped file's usage is missing from the week with no cue on
 * the line, and a 10 MB cap would already have dropped 8% of one real week's tokens ($363 of $5,046).
 * A week's spend that quietly reads low is worse than a slow scan, which is why the number sits where
 * it does. Reading less, rather than skipping more, needs line-wise parsing.
 */
export const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;

/**
 * Usage across EVERY project since `since` (epoch ms) — the week's roll-up.
 *
 * A file untouched since the window began cannot hold usage inside it, so it is never opened. That
 * one `statSync` is the whole performance story: measured on 2,016 transcripts (1.12 GB), 230 files /
 * 245 MB are in a live window, ~0.5–0.8s and ~290 MB peak RSS. When the mtime filter is defeated —
 * a restore from backup, an `rsync`, or copying `~/.claude` to a new machine, all of which restamp
 * every file — nothing is skipped and the same scan costs ~3.4–4.1s and ~430 MB.
 */
export function collectUsageSince(
  since: number,
  root: string = join(homedir(), ".claude", "projects"),
): Usage[] {
  const rows: Usage[] = [];
  for (const f of jsonlFiles(root)) {
    try {
      const st = statSync(f);
      if (st.mtimeMs < since || st.size > MAX_TRANSCRIPT_BYTES) continue;
      parseUsageInto(readFileSync(f, "utf8"), rows, since);
    } catch {
      continue;
    }
  }
  return rows;
}
