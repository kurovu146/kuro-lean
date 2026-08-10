import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
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
    const line = typeof c?.line === "string" ? c.line : null;
    return { line, stale: !c?.writtenAtMs || now - c.writtenAtMs > WEEKLY_TTL_MS };
  } catch {
    return { line: null, stale: true };
  }
}

/** Scan the week and write the cache. Runs in a detached child, never on the statusline's path. */
export function refreshWeekly(
  now: number,
  paths: { root?: string; configPath?: string; cachePath?: string },
  table: PricingTable,
): void {
  const rows = collectUsageSince(cycleStart(now, paths.configPath), paths.root);
  const line = formatWeekly(rows, table);
  try {
    writeFileSync(paths.cachePath ?? weeklyCachePath(), JSON.stringify({ writtenAtMs: now, line }));
  } catch {}
}

/**
 * `mkdir` either creates the directory or throws — atomic across processes, unlike "check then
 * write". A lock older than LOCK_STALE_MS is taken over: its owner is gone.
 */
export function acquireLock(now: number, lockDir: string): boolean {
  try {
    mkdirSync(lockDir);
    return true;
  } catch {}
  try {
    if (now - statSync(lockDir).mtimeMs > LOCK_STALE_MS) {
      rmSync(lockDir, { recursive: true, force: true });
      mkdirSync(lockDir);
      return true;
    }
  } catch {}
  return false;
}

export function releaseLock(lockDir: string): void {
  try {
    rmSync(lockDir, { recursive: true, force: true });
  } catch {}
}
