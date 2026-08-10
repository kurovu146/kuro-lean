import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { priceOf, tallyUsage, renderCost, perTurnCost, collectUsageSince, fmtTok, MAX_TRANSCRIPT_BYTES, type Usage } from "../src/cost";
import { defaultConfig } from "../src/config";

const P = defaultConfig.pricing;

test("priceOf matches a model by prefix, ignoring the date suffix", () => {
  expect(priceOf("claude-opus-5", P)).toEqual({ input: 5, output: 25 });
  expect(priceOf("claude-haiku-4-5-20251001", P)).toEqual({ input: 1, output: 5 });
});

test("priceOf on an unknown model => null (better skipped than miscounted)", () => {
  expect(priceOf("gpt-4o", P)).toBeNull();
});

test("tallyUsage: cache write bills 2x the input price, cache read 0.1x, output at the output price", () => {
  const rows: Usage[] = [
    { model: "claude-opus-5", input: 0, cacheWrite: 1_000_000, cacheRead: 0, output: 0 },
    { model: "claude-opus-5", input: 0, cacheWrite: 0, cacheRead: 1_000_000, output: 0 },
    { model: "claude-opus-5", input: 0, cacheWrite: 0, cacheRead: 0, output: 1_000_000 },
    { model: "claude-opus-5", input: 1_000_000, cacheWrite: 0, cacheRead: 0, output: 0 },
  ];
  const t = tallyUsage(rows, P);
  expect(t.cost.cacheWrite).toBeCloseTo(10, 5); // 5 * 2
  expect(t.cost.cacheRead).toBeCloseTo(0.5, 5); // 5 * 0.1
  expect(t.cost.output).toBeCloseTo(25, 5);
  expect(t.cost.input).toBeCloseTo(5, 5);
  expect(t.total).toBeCloseTo(40.5, 5);
});

test("tallyUsage skips a model missing from the price table without breaking the total", () => {
  const t = tallyUsage(
    [
      { model: "claude-opus-5", input: 1_000_000, cacheWrite: 0, cacheRead: 0, output: 0 },
      { model: "mystery-model", input: 9_999_999, cacheWrite: 0, cacheRead: 0, output: 0 },
    ],
    P,
  );
  expect(t.total).toBeCloseTo(5, 5);
  expect(t.skipped).toEqual(["mystery-model"]);
});

test("tallyUsage: a zero-token unpriced row is never flagged as skipped", () => {
  // Claude Code logs its own bookkeeping under pseudo-models (e.g. "<synthetic>" on an interrupted
  // turn) with all four token fields at 0. It can't move the bill, so it must not read as a pricing gap.
  const t = tallyUsage(
    [
      { model: "claude-opus-5", input: 1_000_000, cacheWrite: 0, cacheRead: 0, output: 0 },
      { model: "<synthetic>", input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
    ],
    P,
  );
  expect(t.total).toBeCloseTo(5, 5);
  expect(t.skipped).toEqual([]);
});

test("renderCost: empty => a hint sentence, not an empty table", () => {
  expect(renderCost([], P)).toContain("no usage data yet");
});

test("renderCost sorts by cost descending and states the largest share", () => {
  const out = renderCost(
    [
      { model: "claude-opus-5", input: 0, cacheWrite: 0, cacheRead: 100_000_000, output: 0 },
      { model: "claude-haiku-4-5", input: 0, cacheWrite: 0, cacheRead: 1_000, output: 0 },
    ],
    P,
  );
  expect(out.indexOf("opus-5")).toBeLessThan(out.indexOf("haiku"));
  expect(out).toContain("cache read");
});

test("perTurnCost: cost of re-reading context on EVERY following turn = tokens * 0.1 * input price", () => {
  // a 200k-token context on Opus 5 => 200000 * 0.1 * 5 / 1e6 = $0.10
  expect(perTurnCost(200_000, "claude-opus-5", P)).toBeCloseTo(0.1, 6);
});

test("perTurnCost: a model outside the price table => null (hidden rather than guessed)", () => {
  expect(perTurnCost(200_000, "gpt-4o", P)).toBeNull();
});

/** One transcript line carrying usage, as Claude Code writes it. */
function usageLine(ts: string, model: string, out: number): string {
  return JSON.stringify({
    timestamp: ts,
    message: { model, usage: { input_tokens: 10, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  });
}

/** One assistant reply as Claude Code writes it: identified by message.id + requestId. */
function identifiedLine(ts: string, id: string, req: string, out: number): string {
  return JSON.stringify({
    timestamp: ts,
    requestId: req,
    message: { id, model: "claude-opus-5", usage: { input_tokens: 10, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  });
}

// Claude Code rewrites earlier messages into a new transcript when a session is resumed, forked or
// compacted, so the same reply is on disk many times over. Measured on one real quota week: 24,344
// rows collapsing to 9,711 - 57% of the tokens were the same messages counted again. Billing them
// repeatedly is what made the week read 5.24B against ccusage's 2.24B.
test("the same message in two transcripts is billed once", () => {
  const root = mkdtempSync(join(tmpdir(), "kt-dupe-"));
  mkdirSync(join(root, "-proj-a"));
  mkdirSync(join(root, "-proj-b"));
  const line = identifiedLine("2026-08-09T00:00:00Z", "msg_01", "req_01", 500);
  writeFileSync(join(root, "-proj-a", "s.jsonl"), line);
  writeFileSync(join(root, "-proj-b", "resumed.jsonl"), line);

  const rows = collectUsageSince(0, root);

  expect(rows.length).toBe(1);
  expect(rows[0]!.output).toBe(500);
});

test("a message repeated inside one transcript is billed once", () => {
  const root = mkdtempSync(join(tmpdir(), "kt-dupe1-"));
  mkdirSync(join(root, "-proj"));
  const line = identifiedLine("2026-08-09T00:00:00Z", "msg_02", "req_02", 7);
  writeFileSync(join(root, "-proj", "s.jsonl"), [line, line, line].join("\n"));

  expect(collectUsageSince(0, root).length).toBe(1);
});

test("same message id, different requests => two real replies, both billed", () => {
  const root = mkdtempSync(join(tmpdir(), "kt-dupe2-"));
  mkdirSync(join(root, "-proj"));
  writeFileSync(
    join(root, "-proj", "s.jsonl"),
    [identifiedLine("2026-08-09T00:00:00Z", "msg_03", "req_a", 1),
     identifiedLine("2026-08-09T00:00:01Z", "msg_03", "req_b", 2)].join("\n"),
  );

  expect(collectUsageSince(0, root).length).toBe(2);
});

test("rows without an id are never collapsed into each other", () => {
  const root = mkdtempSync(join(tmpdir(), "kt-dupe3-"));
  mkdirSync(join(root, "-proj"));
  // Real usage that simply carries no identity: dropping it would understate the bill, which is a
  // worse error than counting an unidentifiable row twice.
  writeFileSync(
    join(root, "-proj", "s.jsonl"),
    [usageLine("2026-08-09T00:00:00Z", "claude-opus-5", 3),
     usageLine("2026-08-09T00:00:01Z", "claude-opus-5", 4)].join("\n"),
  );

  expect(collectUsageSince(0, root).length).toBe(2);
});

test("collectUsageSince keeps rows inside the window, drops older ones", () => {
  const root = mkdtempSync(join(tmpdir(), "kt-since-"));
  mkdirSync(join(root, "-proj-a"));
  writeFileSync(
    join(root, "-proj-a", "s.jsonl"),
    [usageLine("2026-08-01T00:00:00Z", "claude-opus-5", 111),
     usageLine("2026-08-09T00:00:00Z", "claude-opus-5", 222)].join("\n"),
  );

  const rows = collectUsageSince(Date.parse("2026-08-07T00:00:00Z"), root);

  expect(rows.length).toBe(1);
  expect(rows[0]!.output).toBe(222);
});

test("collectUsageSince never opens a file untouched since the window began", () => {
  const root = mkdtempSync(join(tmpdir(), "kt-mtime-"));
  mkdirSync(join(root, "-proj-b"));
  // Deliberately a VALID, in-window row: the only reason it must not appear is the mtime skip. If
  // that skip regresses, this row is parsed and the count goes to 1.
  const stale = join(root, "-proj-b", "old.jsonl");
  writeFileSync(stale, usageLine("2026-08-09T00:00:00Z", "claude-opus-5", 999));
  const old = new Date("2026-07-01T00:00:00Z");
  utimesSync(stale, old, old);

  const rows = collectUsageSince(Date.parse("2026-08-07T00:00:00Z"), root);

  expect(rows.length).toBe(0);
});

test("collectUsageSince skips a transcript past the size cap, and reads the same one under it", () => {
  const root = mkdtempSync(join(tmpdir(), "kt-cap-"));
  mkdirSync(join(root, "-proj-d"));
  const small = join(root, "-proj-d", "small.jsonl");
  const big = join(root, "-proj-d", "big.jsonl");
  const line = usageLine("2026-08-09T00:00:00Z", "claude-opus-5", 42);
  writeFileSync(small, line);

  // Same usage row, then padding that carries the file past the cap. The padding is an unparseable
  // line in both runs below, so the ONLY thing that can move the count is the size gate.
  writeFileSync(big, line + "\n");
  appendFileSync(big, Buffer.alloc(MAX_TRANSCRIPT_BYTES, 0x78));
  expect(collectUsageSince(0, root).length).toBe(1);

  writeFileSync(big, line + "\n" + "x");
  expect(collectUsageSince(0, root).length).toBe(2);
});

test("collectUsageSince keeps a row whose entry has no timestamp", () => {
  const root = mkdtempSync(join(tmpdir(), "kt-nots-"));
  mkdirSync(join(root, "-proj-c"));
  writeFileSync(
    join(root, "-proj-c", "s.jsonl"),
    JSON.stringify({ message: { model: "claude-opus-5", usage: { input_tokens: 5, output_tokens: 7 } } }),
  );

  const rows = collectUsageSince(Date.parse("2026-08-07T00:00:00Z"), root);

  expect(rows.length).toBe(1);
  expect(rows[0]!.output).toBe(7);
});

test("collectUsageSince on a missing root returns nothing", () => {
  expect(collectUsageSince(0, join(tmpdir(), "kt-does-not-exist"))).toEqual([]);
});

test("fmtTok switches unit at each boundary", () => {
  expect(fmtTok(999)).toBe("999");
  expect(fmtTok(1_000)).toBe("1k");
  expect(fmtTok(1_000_000)).toBe("1.0M");
  expect(fmtTok(2_700_000_000)).toBe("2.7B");
});
