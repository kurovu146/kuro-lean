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
 *
 * A reset that has already PASSED is refused for the same reason. `~/.claude.json` is a cache Claude
 * Code refetches on its own schedule, so it straddles every weekly boundary still holding the
 * PREVIOUS week's `resets_at`: anchoring to it there totals a CLOSED week and prints it as this
 * week's spend, with nothing on the line to say so — and the `📅` clock beside it has already
 * dropped that same expired window, so the two disagree silently. The rolling week is at worst a few
 * hours out of phase with the real one; a stale anchor is a whole week wrong.
 */
export function cycleStart(now: number, configPath: string = join(homedir(), ".claude.json")): number {
  try {
    const resets = JSON.parse(readFileSync(configPath, "utf8"))
      ?.cachedUsageUtilization?.utilization?.seven_day?.resets_at;
    const t = resets ? Date.parse(resets) : NaN;
    if (!Number.isNaN(t) && t > now) return t - WEEK_MS;
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

export function weeklyCachePath(dir: string = process.env.KT_TMPDIR || tmpdir()): string {
  return join(dir, "kt-weekly.json");
}

export function weeklyLockPath(dir: string = process.env.KT_TMPDIR || tmpdir()): string {
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
 * The write and the rename are separate `try`s, and BOTH clear the temp file best-effort on their
 * way out: a rename that fails (the destination is occupied by something rename can't replace)
 * leaves a complete temp file behind, and a write that fails partway leaves a partial one. Neither
 * belongs next to the cache forever.
 */
export function refreshWeekly(
  now: number,
  paths: { root?: string; configPath?: string; cachePath?: string },
  table: PricingTable,
): void {
  const root = paths.root ?? process.env.KT_PROJECTS_ROOT ?? undefined;
  const rows = collectUsageSince(cycleStart(now, paths.configPath), root);
  const line = formatWeekly(rows, table);
  const cachePath = paths.cachePath ?? weeklyCachePath();
  const tmp = `${cachePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    writeFileSync(tmp, JSON.stringify({ writtenAtMs: now, line }));
  } catch {
    // Not always a no-op: a write that throws on open created nothing, but one that throws partway
    // (ENOSPC after the file exists) leaves a partial temp file that nobody else will ever collect.
    try {
      rmSync(tmp, { force: true });
    } catch {}
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
 * write" — and it is the only path here that can return `true`: a caller never claims a directory it
 * did not create itself.
 *
 * That is still not mutual exclusion, and two callers CAN both come away believing they hold this.
 * The staleness check and the `rmSync` acting on it are separate syscalls with no identity check
 * between them, so a caller preempted in that gap wakes up and deletes whatever sits at the path by
 * then — which may be a FRESH directory another caller created meanwhile and is actively scanning
 * behind. That owner never learns it was evicted, the path is now free for the next caller to take,
 * and the two of them scan at once. Closing this needs an atomic compare-identity-and-mutate, which
 * POSIX does not offer without a native advisory lock (`flock`) that the plan's no-new-dependency
 * constraint rules out; three earlier rounds of rename-and-verify each closed one interleaving and
 * opened a narrower one.
 *
 * It stays this way because the loss is bounded, not because it is safe: `refreshWeekly` swaps the
 * cache in with a rename, so the entire cost of a lost race is one redundant ~0.5s scan — never a
 * torn file or a wrong number. Best-effort de-duplication of a background scan, not a lock: do not
 * reach for it anywhere correctness depends on exclusivity.
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
