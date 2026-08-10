import { test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { acquireLock, claimStaleLock, cycleStart, formatWeekly, readWeekly, refreshWeekly, releaseLock, WEEK_MS, WEEKLY_TTL_MS } from "../src/weekly";
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

test("a lock left behind by a dead process is reaped", () => {
  const lock = join(mkdtempSync(join(tmpdir(), "kt-wstale-")), "lock");
  mkdirSync(lock);
  const old = new Date(NOW - 121_000);
  utimesSync(lock, old, old);
  expect(acquireLock(NOW, lock)).toBe(true);
});

test("claiming a stale lock is atomic: a second claim on the same directory throws", () => {
  const lock = join(mkdtempSync(join(tmpdir(), "kt-wclaim-")), "lock");
  mkdirSync(lock);
  const old = new Date(NOW - 121_000);
  utimesSync(lock, old, old);
  const observedMtimeMs = statSync(lock).mtimeMs;

  // Two callers whose statSync both saw the same stale mtime would, in a real race, both reach this
  // exact point before either one mutates. Replaying the claim twice back-to-back with no recreate in
  // between is that interleaving: `rename` requires its source to exist, so only the first call can
  // find `lock` still there — the bug this closed was that the old rm+mkdir pair let BOTH succeed
  // (rmSync's `force: true` never throws on an already-missing target).
  const claim = claimStaleLock(lock, observedMtimeMs); // caller A wins the claim
  expect(claim).not.toBeNull();
  expect(() => claimStaleLock(lock, observedMtimeMs)).toThrow(); // caller B's source is already gone
  rmSync(claim!, { recursive: true, force: true }); // acquireLock does this cleanup itself; replicate it here
});

test("a reap against a stale mtime someone else already replaced does not steal the lock", () => {
  const lock = join(mkdtempSync(join(tmpdir(), "kt-wracer2-")), "lock");
  mkdirSync(lock);
  const old = new Date(NOW - 121_000);
  utimesSync(lock, old, old);
  const observedStale = statSync(lock).mtimeMs; // what BOTH callers would have seen before either mutated

  // Caller A runs the real, full acquireLock cycle and legitimately wins.
  expect(acquireLock(NOW, lock)).toBe(true);

  // Caller B decided "stale" from that SAME earlier read. Replaying its reap against the mtime it
  // observed — now that A's fresh lock sits at `lock` — must fail, and must leave A's lock intact.
  // `rename`'s "source must exist" guarantee alone does NOT catch this: it happily moves whatever is
  // currently there, stale or not, so a naive claim would silently steal A's fresh directory.
  expect(claimStaleLock(lock, observedStale)).toBeNull();
  expect(existsSync(lock)).toBe(true);
  expect(statSync(lock).mtimeMs).not.toBe(observedStale); // still A's fresh dir, correctly restored
});

test("refreshWeekly's atomic write leaves no temp file behind", () => {
  const root = mkdtempSync(join(tmpdir(), "kt-wrefresh2-"));
  const cachePath = join(mkdtempSync(join(tmpdir(), "kt-wout2-")), "kt-weekly.json");

  refreshWeekly(NOW, { root, configPath: join(tmpdir(), "kt-none2.json"), cachePath }, PRICING);

  // The write goes to a private temp file next to the cache, then a rename swaps it into place — if
  // that rename is ever dropped, a stray "kt-weekly.json.tmp-..." would be left sitting next to it.
  expect(readdirSync(dirname(cachePath))).toEqual(["kt-weekly.json"]);
});
