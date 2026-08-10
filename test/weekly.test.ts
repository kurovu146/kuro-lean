import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { cycleStart, formatWeekly, WEEK_MS } from "../src/weekly";
import type { Usage } from "../src/cost";

const NOW = Date.parse("2026-08-10T08:00:00Z");
const PRICING = { "claude-opus-5": { input: 5, output: 25 } };

function row(model: string, over: Partial<Usage> = {}): Usage {
  return { model, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, ...over };
}

function configWith(sevenDay: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), "kt-cycle-")), "claude.json");
  writeFileSync(p, JSON.stringify({ cachedUsageUtilization: { utilization: { seven_day: sevenDay } } }));
  return p;
}

test("cycleStart is the real reset minus a week", () => {
  const p = configWith({ resets_at: "2026-08-13T22:00:00Z" });
  expect(cycleStart(NOW, p)).toBe(Date.parse("2026-08-06T22:00:00Z"));
});

test("cycleStart falls back to a rolling week when the config has no reset", () => {
  const p = configWith(null);
  expect(cycleStart(NOW, p)).toBe(NOW - WEEK_MS);
});

test("cycleStart falls back when the config file is missing entirely", () => {
  expect(cycleStart(NOW, join(tmpdir(), "kt-no-such-config.json"))).toBe(NOW - WEEK_MS);
});

test("formatWeekly prices the week and counts its tokens", () => {
  // 200M output on opus-5 at $25/1M = $5000 -> "$5.0k"; tokens 200M -> "200.0M"
  const rows = [row("claude-opus-5", { output: 200_000_000 })];
  expect(formatWeekly(rows, PRICING)).toBe("💵 wk $5.0k 200.0M");
});

test("an unpriced model still counts tokens and marks the money", () => {
  const rows = [row("claude-opus-5", { output: 40_000_000 }), row("some-new-model", { output: 10_000_000 })];
  // $1000 priced -> "$1.0k", plus the marker; tokens include BOTH models -> 50M
  expect(formatWeekly(rows, PRICING)).toBe("💵 wk $1.0k+? 50.0M");
});

test("nothing priced at all => the money is a question mark, not a confident zero", () => {
  const rows = [row("some-new-model", { output: 10_000_000 })];
  expect(formatWeekly(rows, PRICING)).toBe("💵 wk $? 10.0M");
});

test("no usage in the window => nothing to render", () => {
  expect(formatWeekly([], PRICING)).toBeNull();
});
