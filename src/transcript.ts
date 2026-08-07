import { closeSync, openSync, readSync, statSync } from "fs";

/**
 * How long has the HUMAN been away — not how long since the file was last written.
 *
 * The transcript holds far more than the conversation: `file-history-snapshot`, `file-history-delta`,
 * `ai-title`, `mode`, `last-prompt`, `attachment`. Claude Code appends those while the panel sits
 * untouched, so the file's mtime keeps moving and every idle figure derived from it is an undercount.
 * Measured 2026-08-05: a panel idle 3h38m reported 22m, because bookkeeping had landed at minute 22.
 *
 * Only `user` and `assistant` entries mean somebody (or the model) actually did something.
 */
const TAIL_BYTES = 64 * 1024;

const ACTIVITY_TYPES = new Set(["user", "assistant"]);

/** Read the last `bytes` of a file without loading it all into RAM. */
function readTail(path: string, bytes: number): string {
  let fd: number | null = null;
  try {
    const size = statSync(path).size;
    const len = Math.min(bytes, size);
    fd = openSync(path, "r");
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== null) try { closeSync(fd); } catch {}
  }
}

/** PURE: the newest conversation timestamp in these lines, in ms. 0 = none found. */
export function lastActivityIn(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // the slice may cut the first line in half — skipping it is correct
    }
    if (!ACTIVITY_TYPES.has(e?.type)) continue;
    const t = Date.parse(e?.timestamp ?? "");
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

/**
 * When the conversation last moved, in ms. 0 = unknown (unreadable, or no conversation entry in the
 * tail) — callers fall back to mtime rather than inventing a number.
 */
export function lastActivity(path: string): number {
  return lastActivityIn(readTail(path, TAIL_BYTES).split("\n"));
}

/** Minutes since the human last did anything. Falls back to mtime when the tail yields nothing. */
export function idleMinutes(path: string, now: number = Date.now()): number {
  const at = lastActivity(path);
  if (at > 0) return Math.max(0, (now - at) / 60_000);
  try {
    return Math.max(0, (now - statSync(path).mtimeMs) / 60_000);
  } catch {
    return 0;
  }
}
