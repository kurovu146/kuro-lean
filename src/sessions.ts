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

/** cwd/gitBranch appear scattered through the transcript; take the first occurrence near the head. */
export function readMeta(path: string): { cwd: string; branch: string } {
  const head = readSlice(path, HEAD_BYTES, "head");
  return {
    cwd: /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1] ?? "",
    branch: /"gitBranch":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1] ?? "",
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

  found.sort((a, b) => b.mtime - a.mtime);
  // mtime stays the scan key — it costs one stat() across ~1,900 files. But the idle a human READS
  // comes from the last conversation entry: bookkeeping writes keep mtime fresh on an abandoned
  // session, which would make it look recently worked on. Only the printed rows pay for that read.
  return found
    .slice(0, opts.limit)
    .map((r) => {
      const { cwd, branch } = readMeta(r.path);
      const { tokens, model } = readLastUsage(r.path);
      return {
        path: r.path,
        cwd,
        branch,
        idleMinutes: idleMinutes(r.path, now),
        tokens,
        model,
        bytes: r.bytes,
      };
    })
    // Re-sort on the number actually printed. mtime picked the candidates; showing them in mtime
    // order would leave the idle column jumping around (0m, 14h, 22h, 6h) and unreadable.
    .sort((a, b) => a.idleMinutes - b.idleMinutes);
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

/** `--from`: a row number from the table, or a path outright. null = not understood → don't guess. */
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

/** Parse the flags of `kt handoff`. Kept away from I/O so it's testable without building a CLI. */
export function parseHandoffArgs(rest: string[]): HandoffArgs {
  const copy = rest.includes("--copy");
  const args = rest.filter((a) => a !== "--copy"); // filter first, or it becomes the filename
  if (args[0] === "--list") return { mode: "list", limit: Number(args[1]) || 10 };
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
