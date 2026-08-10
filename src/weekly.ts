import { readFileSync } from "fs";
import { homedir } from "os";
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
