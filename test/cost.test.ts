import { test, expect } from "bun:test";
import { priceOf, tallyUsage, renderCost, perTurnCost, type Usage } from "../src/cost";
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
