import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { collectUsageSince, fmtTok, tallyUsage, type PricingTable, type Usage } from "./cost";

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The start of the current quota week: Claude Code's own `resets_at` minus seven days.
 *
 * Deriving it from the real reset beats guessing a weekday — the reset can shift, and a hardcoded
 * "Friday 5am" is only ever right by luck. No cached utilization yet (fresh install) => a rolling
 * week, so the segment still renders on day one.
 */
export function cycleStart(now: number, configPath: string = join(homedir(), ".claude.json")): number {
  try {
    const resets = JSON.parse(readFileSync(configPath, "utf8"))
      ?.cachedUsageUtilization?.utilization?.seven_day?.resets_at;
    const t = resets ? Date.parse(resets) : NaN;
    if (!Number.isNaN(t)) return t - WEEK_MS;
  } catch {}
  return now - WEEK_MS;
}

function fmtCost(c: number): string {
  if (c >= 1000) return `$${(c / 1000).toFixed(1)}k`;
  if (c >= 100) return `$${Math.round(c)}`;
  return `$${c.toFixed(1)}`;
}

/**
 * The week's line (PURE): "💵 wk $1.7k 2.7B".
 *
 * Tokens are summed off every row, money only off the ones that have a price. `tallyUsage` drops
 * unpriced models entirely — right for the bill, wrong for the token count — so a model kt has no
 * price for still shows its tokens, and the money carries `+?` instead of quietly reading low.
 */
export function formatWeekly(rows: Usage[], table: PricingTable): string | null {
  if (!rows.length) return null;
  const tokens = rows.reduce((n, r) => n + r.input + r.cacheWrite + r.cacheRead + r.output, 0);
  const t = tallyUsage(rows, table);
  const money = t.skipped.length
    ? t.total
      ? `${fmtCost(t.total)}+?`
      : "$?"
    : fmtCost(t.total);
  return `💵 wk ${money} ${fmtTok(tokens)}`;
}

/** How long a cached line is trusted before a background rescan is asked for. */
export const WEEKLY_TTL_MS = 10 * 60 * 1000;
/** A lock older than this belongs to a process that died mid-scan. */
const LOCK_STALE_MS = 120 * 1000;

export function weeklyCachePath(dir: string = tmpdir()): string {
  return join(dir, "kt-weekly.json");
}

export function weeklyLockPath(dir: string = tmpdir()): string {
  return join(dir, "kt-weekly.lock");
}

/**
 * The cached line plus whether it has aged out. Reads only — the decision to rescan belongs to the
 * caller, so nothing here can spawn a process behind a test's back.
 */
export function readWeekly(
  now: number,
  cachePath: string = weeklyCachePath(),
): { line: string | null; stale: boolean } {
  try {
    const c = JSON.parse(readFileSync(cachePath, "utf8"));
    // A missing/non-numeric writtenAtMs means there is no trustworthy age for the line, so the line
    // itself is withheld too — a string sitting next to garbage metadata is not a line worth showing.
    if (typeof c?.writtenAtMs !== "number") return { line: null, stale: true };
    const line = typeof c.line === "string" ? c.line : null;
    return { line, stale: now - c.writtenAtMs > WEEKLY_TTL_MS };
  } catch {
    return { line: null, stale: true };
  }
}

/**
 * Scan the week and write the cache. Runs in a detached child, never on the statusline's path.
 *
 * The write itself goes to a private temp file next to the cache, then a `renameSync` swaps it into
 * place. Rename within one directory is atomic, so a concurrent `readWeekly` sees either the old
 * complete file or the new one — never a half-written JSON blob from two refreshes interleaving. Two
 * refreshes racing now just costs a duplicated scan, nothing worse.
 *
 * The write and the rename are separate `try`s: if the write itself fails there is no temp file to
 * clean up, but if the write succeeds and ONLY the rename fails (e.g. the destination is occupied by
 * something rename can't replace), the temp file is removed best-effort rather than left behind
 * forever next to the cache.
 */
export function refreshWeekly(
  now: number,
  paths: { root?: string; configPath?: string; cachePath?: string },
  table: PricingTable,
): void {
  const rows = collectUsageSince(cycleStart(now, paths.configPath), paths.root);
  const line = formatWeekly(rows, table);
  const cachePath = paths.cachePath ?? weeklyCachePath();
  const tmp = `${cachePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    writeFileSync(tmp, JSON.stringify({ writtenAtMs: now, line }));
  } catch {
    return;
  }
  try {
    renameSync(tmp, cachePath);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {}
  }
}

/**
 * `mkdir` either creates the directory or throws — atomic across processes, unlike "check then
 * write". This is intentionally NOT mutual exclusion: two rounds of trying to make a stale takeover
 * atomic (rename-away, then verify-and-restore) each closed one interleaving and opened a narrower
 * one — a 3-caller interleaving still lets two callers both believe they hold the lock, and a real fix
 * needs a kernel-level advisory lock (`flock`), which a native dependency would provide but the
 * plan's constraints forbid.
 *
 * So this does something weaker but actually correct: claim the lock ONLY by creating it (atomic,
 * genuinely exclusive), and if someone else already holds it, clear it if it looks abandoned — but
 * decline this call regardless. Nobody takes over a directory they did not create, so the
 * double-acquire family does not shrink, it disappears. Two callers racing to clear the same corpse
 * is idempotent (`rmSync` with `force: true`). The cost of a live-but-slow owner losing its directory
 * to an over-eager clear is one redundant scan seconds later — harmless now that `refreshWeekly`'s
 * cache write is atomic. This is best-effort de-duplication of a background scan, not a real lock:
 * do not reach for it anywhere correctness depends on exclusivity.
 */
export function acquireLock(now: number, lockDir: string): boolean {
  try {
    mkdirSync(lockDir);
    return true;
  } catch {}
  try {
    if (now - statSync(lockDir).mtimeMs > LOCK_STALE_MS) rmSync(lockDir, { recursive: true, force: true });
  } catch {}
  return false;
}

export function releaseLock(lockDir: string): void {
  try {
    rmSync(lockDir, { recursive: true, force: true });
  } catch {}
}
