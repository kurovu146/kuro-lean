import { closeSync, openSync, readSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { CACHE_WRITE_MULT, priceOf, type PricingTable } from "./cost";
import { fmtIdle } from "./statusline";
import { idleMinutes } from "./transcript";

/**
 * Find abandoned sessions across the WHOLE MACHINE. `kt handoff --recover` follows cwd, so it only
 * helps when you already know which repo the session was in — and forgetting to run handoff usually
 * means forgetting that too.
 *
 * 1,901 transcripts / 900MB on a real machine: never read whole files. stat() filters first, and only
 * the few files that make the list get a few KB read from the head (cwd/branch) and tail (usage).
 */

const HEAD_BYTES = 16_000;
const TAIL_BYTES = 64_000;

/**
 * The default row count, for BOTH `--list` and the lookup behind `--recover --from <#>`. One constant
 * on purpose: when the two were 10 and 20, row 7 on screen and row 7 in the rescue were different
 * sessions. It also has to clear the number of sessions actually kept open at once — at 10, a live
 * 585k-token session sat at row 13 and looked like it had been dropped. `--list N` may ask for more,
 * and the lookup then grows to match the row (see fromLimit) rather than losing sight of it.
 */
export const LIST_LIMIT = 20;

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
  /** Below this, treat the session as having nothing worth rescuing. */
  minBytes: number;
  limit: number;
  now?: number;
}

/** Read a slice of bytes from the head or tail of a file, without loading it all into RAM. */
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

/**
 * cwd/gitBranch appear scattered through the transcript; take the first occurrence near the head.
 *
 * `team` is what marks a TEAMMATE: one orchestrator run drops a full transcript per spawned agent
 * into the same project directory, all big and all touched minutes apart. `agentName` can't be the
 * marker — Claude Code also parks an auto-generated session title there ("Nghiên cứu Polytail"), so
 * filtering on it hides real sessions. `teamName` is only ever set on a spawned teammate: across 885
 * transcripts here, every parent (including the 6 MB orchestrator) had none.
 */
export function readMeta(path: string): { cwd: string; branch: string; team: string } {
  const head = readSlice(path, HEAD_BYTES, "head");
  return {
    cwd: /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1] ?? "",
    branch: /"gitBranch":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1] ?? "",
    // A transcript quoting another transcript escapes its quotes (\"teamName\":), so this only
    // matches the real field, never a teammate brief echoed into an orchestrator's own log.
    team: /"teamName":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1] ?? "",
  };
}

/** The LAST turn's usage = the context size that must be reloaded. Read backwards from the tail. */
export function readLastUsage(path: string): { tokens: number; model: string } {
  const lines = readSlice(path, TAIL_BYTES, "tail").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // the slice may cut the first line in half — skipping it is correct
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

  if (opts.limit < 1) return [];
  found.sort((a, b) => b.mtime - a.mtime);

  /**
   * The rows are ranked by the idle a human READS — the last conversation entry — because bookkeeping
   * writes keep mtime fresh on an abandoned session. Reading that out of ~830 candidates would throw
   * away the stat()-first design, so lean on the one guarantee mtime gives: the last message can never
   * be newer than the last write, so idle-by-mtime is a LOWER BOUND on real idle. Walking newest-mtime
   * first, that bound only grows; once it passes the worst row already held, nothing further down can
   * beat it — stop. On a real machine that reads 15 tails instead of 827.
   *
   * The result is the EXACT top-N, which is what makes the row numbers usable: `--list` prints 10 rows
   * and `--recover --from <#>` resolves against 20, so a shorter table has to be a prefix of a longer
   * one. Ranking a slice (mtime first, then re-sort) is not — it made row 7 two different sessions.
   */
  const best: { path: string; bytes: number; idle: number; cwd: string; branch: string }[] = [];
  for (const c of found) {
    const floor = (now - c.mtime) / 60_000;
    if (best.length >= opts.limit && floor >= best[best.length - 1]!.idle) break;
    // Skipped BEFORE ranking, not after: teammates are the freshest files on disk, so filtering the
    // finished table would leave it short while the parent still sat below the fold.
    const { cwd, branch, team } = readMeta(c.path);
    if (team) continue;
    const idle = idleMinutes(c.path, now);
    const at = best.findIndex((b) => b.idle > idle);
    best.splice(at < 0 ? best.length : at, 0, { path: c.path, bytes: c.bytes, idle, cwd, branch });
    if (best.length > opts.limit) best.pop();
  }

  // Only the surviving rows pay for the tail read (usage); the head read already happened above.
  return best.map((r) => {
    const { tokens, model } = readLastUsage(r.path);
    return { path: r.path, cwd: r.cwd, branch: r.branch, idleMinutes: r.idle, tokens, model, bytes: r.bytes };
  });
}

/** A table for a human to scan: which column costs the most, which session is worth rescuing. */
export function renderSessions(rows: SessionRow[], pricing: PricingTable, home: string = homedir()): string {
  if (!rows.length) return "No sessions worth rescuing were found.\n";
  const out = ["  #  idle      context     reload    session"];
  rows.forEach((r, i) => {
    const price = r.model ? priceOf(r.model, pricing) : null;
    const money = price ? `$${((r.tokens / 1e6) * price.input * CACHE_WRITE_MULT).toFixed(2)}` : "—";
    const where = r.cwd ? (r.cwd.startsWith(home) ? "~" + r.cwd.slice(home.length) : r.cwd) : r.path;
    // tokens 0 = no usage found in the tail, which is NOT "an empty session" — don't print 0k and get skipped
    const ctx = r.tokens ? `${Math.round(r.tokens / 1000)}k tok` : "? tok";
    out.push(
      `  ${String(i + 1).padEnd(2)} ${fmtIdle(r.idleMinutes).padEnd(9)} ` +
        `${ctx.padStart(9)}   ${money.padEnd(8)}  ` +
        `${where}${r.branch ? ` (${r.branch})` : ""}`,
    );
  });
  return out.join("\n") + "\n";
}

/** Is this `--from` a row number off the table, rather than a path? One rule, three callers. */
export function isRowNumber(arg: string): boolean {
  return /^\d+$/.test(arg.trim());
}

/**
 * `--from <#>`: how many rows the lookup table must hold to contain the row asked for. `--list N`
 * prints as many rows as you ask it to, so the number read off the screen can sit past LIST_LIMIT —
 * resolving it against 20 rows reported row 31 as an unreadable number. Widening is safe precisely
 * because the ranking is the EXACT top-N: row 31 of a 31-row table is row 31 of the 40-row one.
 */
export function fromLimit(arg: string): number {
  return isRowNumber(arg) ? Math.max(LIST_LIMIT, Number(arg.trim())) : LIST_LIMIT;
}

/** `--from`: a row number from the table, or a path outright. null = not understood → don't guess. */
export function resolveFrom(rows: SessionRow[], arg: string): string | null {
  const s = arg.trim();
  if (isRowNumber(s)) return rows[Number(s) - 1]?.path ?? null;
  return s.includes("/") ? s : null;
}

export type HandoffArgs =
  | { mode: "prompt"; file: string; copy: boolean }
  | { mode: "list"; limit: number }
  | { mode: "recover"; n: number; from: string | null; copy: boolean };

/** Parse the flags of `kt handoff`. Kept away from I/O so it's testable without building a CLI. */
export function parseHandoffArgs(rest: string[]): HandoffArgs {
  const copy = rest.includes("--copy");
  const args = rest.filter((a) => a !== "--copy"); // filter first, or it becomes the filename
  if (args[0] === "--list") return { mode: "list", limit: Number(args[1]) || LIST_LIMIT };
  if (args[0] === "--recover") {
    const tail = args.slice(1);
    const i = tail.indexOf("--from");
    const from = i >= 0 ? tail[i + 1] ?? null : null;
    // Drop the whole `--from X` pair before looking for N, or `--from 2` reads as "the last 2 messages".
    const nums = tail.filter((_, k) => i < 0 || (k !== i && k !== i + 1)).filter((a) => /^\d+$/.test(a));
    return { mode: "recover", n: Number(nums[0]) || 60, from, copy };
  }
  return { mode: "prompt", file: args[0] || ".kt/handoff.md", copy };
}

/** The clipboard command per platform. null = unknown → say so, don't swallow it silently. */
export function clipboardCommand(platform: string): { cmd: string; args: string[] } | null {
  if (platform === "darwin") return { cmd: "pbcopy", args: [] };
  if (platform === "win32") return { cmd: "clip", args: [] };
  if (platform === "linux") return { cmd: "xclip", args: ["-selection", "clipboard"] };
  return null;
}
