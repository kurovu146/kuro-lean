import { test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { acquireLock, cycleStart, formatWeekly, readWeekly, refreshWeekly, releaseLock, runWeeklyRefresh, WEEK_MS, WEEKLY_TTL_MS } from "../src/weekly";
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

test("cycleStart falls back when the config is not valid JSON", () => {
  const p = join(mkdtempSync(join(tmpdir(), "kt-cycle-bad-")), "claude.json");
  writeFileSync(p, "{ cachedUsageUtilization: ");
  expect(cycleStart(NOW, p)).toBe(NOW - WEEK_MS);
});

// ~/.claude.json is a cache Claude Code refetches on its own schedule, so across every weekly reset
// it still holds the PREVIOUS week's `resets_at` until it catches up. Anchoring to an expired reset
// totals a CLOSED week and prints it as this week's spend, with nothing on the line to say so.
test("an expired resets_at is refused — a stale cache must not report a closed week", () => {
  const p = configWith({ resets_at: new Date(NOW - 3 * 24 * 3600_000).toISOString() });
  expect(cycleStart(NOW, p)).toBe(NOW - WEEK_MS);
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

function cacheFile(content: string): string {
  const p = join(mkdtempSync(join(tmpdir(), "kt-wcache-")), "kt-weekly.json");
  writeFileSync(p, content);
  return p;
}

test("a cache inside the TTL is served as-is", () => {
  const p = cacheFile(JSON.stringify({ writtenAtMs: NOW - 60_000, line: "💵 wk $1.0k 5.0M" }));
  expect(readWeekly(NOW, p)).toEqual({ line: "💵 wk $1.0k 5.0M", stale: false });
});

test("past the TTL the line is still served, but flagged stale", () => {
  const p = cacheFile(JSON.stringify({ writtenAtMs: NOW - WEEKLY_TTL_MS - 1, line: "💵 wk $1.0k 5.0M" }));
  expect(readWeekly(NOW, p)).toEqual({ line: "💵 wk $1.0k 5.0M", stale: true });
});

test("a corrupt or missing cache hides the segment and asks for a refresh", () => {
  expect(readWeekly(NOW, cacheFile("{not json"))).toEqual({ line: null, stale: true });
  expect(readWeekly(NOW, join(tmpdir(), "kt-no-cache.json"))).toEqual({ line: null, stale: true });
});

test("a cache missing writtenAtMs hides the line too, not just its age", () => {
  const p = cacheFile(JSON.stringify({ line: "💵 wk $1.0k 5.0M" }));
  expect(readWeekly(NOW, p)).toEqual({ line: null, stale: true });
});

test("a non-numeric writtenAtMs is treated the same as missing", () => {
  const p = cacheFile(JSON.stringify({ writtenAtMs: "not a number", line: "💵 wk $1.0k 5.0M" }));
  expect(readWeekly(NOW, p)).toEqual({ line: null, stale: true });
});

test("refreshWeekly scans the transcripts and writes the line", () => {
  const root = mkdtempSync(join(tmpdir(), "kt-wrefresh-"));
  mkdirSync(join(root, "-proj"));
  writeFileSync(
    join(root, "-proj", "s.jsonl"),
    JSON.stringify({
      timestamp: "2026-08-09T00:00:00Z",
      message: { model: "claude-opus-5", usage: { input_tokens: 0, output_tokens: 200_000_000 } },
    }),
  );
  const cachePath = join(mkdtempSync(join(tmpdir(), "kt-wout-")), "kt-weekly.json");

  refreshWeekly(NOW, { root, configPath: join(tmpdir(), "kt-none.json"), cachePath }, PRICING);

  const written = JSON.parse(readFileSync(cachePath, "utf8"));
  expect(written.writtenAtMs).toBe(NOW);
  expect(written.line).toBe("💵 wk $5.0k 200.0M");
});

test("a held lock blocks a second refresh", () => {
  const lock = join(mkdtempSync(join(tmpdir(), "kt-wlock-")), "lock");
  expect(acquireLock(NOW, lock)).toBe(true);
  expect(acquireLock(NOW, lock)).toBe(false);
  releaseLock(lock);
  expect(acquireLock(NOW, lock)).toBe(true);
});

test("a corpse left behind by a dead process is cleared, but this call still declines", () => {
  const lock = join(mkdtempSync(join(tmpdir(), "kt-wstale-")), "lock");
  mkdirSync(lock);
  const old = new Date(NOW - 121_000);
  utimesSync(lock, old, old);

  // acquireLock does not take over a directory it did not create -- clearing a corpse and claiming it
  // in the same call is exactly the shape that let two callers both believe they held the lock across
  // rounds 1 and 2. This call only clears; it does not claim. That is a narrower failure mode, not a
  // closed one -- see the comment on acquireLock for the interleaving that still gets through.
  expect(acquireLock(NOW, lock)).toBe(false);
  expect(existsSync(lock)).toBe(false);

  // The very next call sees an empty path and acquires cleanly through the plain, atomic `mkdirSync`.
  expect(acquireLock(NOW, lock)).toBe(true);
});

test("refreshWeekly's atomic write leaves no temp file behind", () => {
  const root = mkdtempSync(join(tmpdir(), "kt-wrefresh2-"));
  const cachePath = join(mkdtempSync(join(tmpdir(), "kt-wout2-")), "kt-weekly.json");

  refreshWeekly(NOW, { root, configPath: join(tmpdir(), "kt-none2.json"), cachePath }, PRICING);

  // The write goes to a private temp file next to the cache, then a rename swaps it into place — if
  // that rename is ever dropped, a stray "kt-weekly.json.tmp-..." would be left sitting next to it.
  expect(readdirSync(dirname(cachePath))).toEqual(["kt-weekly.json"]);
});

/** A fake home carrying ~/.claude/kt.json, so the global config layer is a fixture, never the machine's. */
function homeWith(pricing: unknown): string {
  const home = mkdtempSync(join(tmpdir(), "kt-whome-"));
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude", "kt.json"), JSON.stringify({ pricing }));
  return home;
}

/** A projects root holding one transcript: 200M output tokens on opus-5, inside the window. */
function rootWithUsage(): string {
  const root = mkdtempSync(join(tmpdir(), "kt-wrun-"));
  mkdirSync(join(root, "-proj"));
  writeFileSync(
    join(root, "-proj", "s.jsonl"),
    JSON.stringify({
      timestamp: "2026-08-09T00:00:00Z",
      message: { model: "claude-opus-5", usage: { input_tokens: 0, output_tokens: 200_000_000 } },
    }),
  );
  return root;
}

test("runWeeklyRefresh prices the week from the global config layer", () => {
  // $50/1M output is nobody's default - reading it back proves ~/.claude/kt.json was consulted, and
  // that the number did not just fall out of defaultConfig.
  const home = homeWith({ "claude-opus-5": { input: 5, output: 50 } });
  const cachePath = join(mkdtempSync(join(tmpdir(), "kt-wrunout-")), "kt-weekly.json");

  runWeeklyRefresh(NOW, {
    root: rootWithUsage(),
    configPath: join(tmpdir(), "kt-none-run.json"),
    cachePath,
    lockPath: join(mkdtempSync(join(tmpdir(), "kt-wrunlock-")), "lock"),
    home,
  });

  expect(JSON.parse(readFileSync(cachePath, "utf8")).line).toBe("💵 wk $10.0k 200.0M");
});

test("runWeeklyRefresh declines while another refresh holds the lock", () => {
  const home = homeWith({ "claude-opus-5": { input: 5, output: 50 } });
  const cachePath = join(mkdtempSync(join(tmpdir(), "kt-wrunout2-")), "kt-weekly.json");
  const lockPath = join(mkdtempSync(join(tmpdir(), "kt-wrunlock2-")), "lock");
  mkdirSync(lockPath); // a scan already in flight

  runWeeklyRefresh(NOW, { root: rootWithUsage(), configPath: join(tmpdir(), "kt-none-run2.json"), cachePath, lockPath, home });

  expect(existsSync(cachePath)).toBe(false); // nothing scanned, nothing written
});

test("runWeeklyRefresh releases the lock for the next refresh", () => {
  const home = homeWith({ "claude-opus-5": { input: 5, output: 50 } });
  const cachePath = join(mkdtempSync(join(tmpdir(), "kt-wrunout3-")), "kt-weekly.json");
  const lockPath = join(mkdtempSync(join(tmpdir(), "kt-wrunlock3-")), "lock");

  runWeeklyRefresh(NOW, { root: rootWithUsage(), configPath: join(tmpdir(), "kt-none-run3.json"), cachePath, lockPath, home });

  expect(existsSync(lockPath)).toBe(false);
});

test("refreshWeekly cleans up its temp file when the final rename fails", () => {
  const root = mkdtempSync(join(tmpdir(), "kt-wrefresh3-"));
  const dir = mkdtempSync(join(tmpdir(), "kt-wout3-"));
  const cachePath = join(dir, "kt-weekly.json");
  mkdirSync(cachePath); // occupies the cache path with a directory, so renaming a FILE onto it (EISDIR) fails

  refreshWeekly(NOW, { root, configPath: join(tmpdir(), "kt-none3.json"), cachePath }, PRICING);

  // The write succeeded; only the rename failed. No stray "kt-weekly.json.tmp-..." should survive next
  // to the (untouched) directory that occupies the cache path.
  expect(readdirSync(dir)).toEqual(["kt-weekly.json"]);
  expect(statSync(cachePath).isDirectory()).toBe(true);
});
