import { test, expect } from "bun:test";
import { rmSync, appendFileSync } from "fs";
import { appendMeta, readMeta, type RunMeta } from "../src/store";
import { renderStats } from "../src/stats";
import { runAndCompress } from "../src/pipeline";
import { defaultConfig } from "../src/config";

const ROOT = "/tmp/kt-test-stats";

const meta = (over: Partial<RunMeta> = {}): RunMeta => ({
  id: "001",
  command: "npm test",
  profile: "test",
  originalChars: 10_000,
  compactChars: 500,
  ...over,
});

test("appendMeta/readMeta round-trip, skipping corrupt lines", () => {
  rmSync(ROOT, { recursive: true, force: true });
  appendMeta(meta(), { root: ROOT });
  appendMeta(meta({ id: "002", command: "git diff" }), { root: ROOT });
  appendFileSync(`${ROOT}/index.jsonl`, "not json\n");
  const all = readMeta(ROOT);
  expect(all.length).toBe(2);
  expect(all[1]!.command).toBe("git diff");
});

test("appendMeta: over maxLines => trimmed to the last keepLines lines", () => {
  rmSync(ROOT, { recursive: true, force: true });
  for (let i = 0; i < 12; i++) {
    appendMeta(meta({ id: String(i) }), { root: ROOT, maxLines: 10, keepLines: 5 });
  }
  const all = readMeta(ROOT);
  expect(all.length).toBeLessThanOrEqual(10);
  expect(all.at(-1)!.id).toBe("11"); // the newest always survives
});

test("readMeta: drops entries with missing/mistyped numeric fields => stats are never NaN", () => {
  rmSync(ROOT, { recursive: true, force: true });
  appendMeta(meta(), { root: ROOT });
  // schema drift: a missing numeric field / a numeric field written as a string
  appendFileSync(`${ROOT}/index.jsonl`, JSON.stringify({ id: "x", command: "c", profile: "generic" }) + "\n");
  appendFileSync(
    `${ROOT}/index.jsonl`,
    JSON.stringify({ id: "y", command: "c", profile: "generic", originalChars: "9", compactChars: 1 }) + "\n",
  );
  const all = readMeta(ROOT);
  expect(all.length).toBe(1);
  expect(renderStats(all)).not.toContain("NaN");
});

test("renderStats: empty => a message, no crash", () => {
  expect(renderStats([])).toContain("no data yet");
});

test("renderStats: total savings + the top commands still occupying context", () => {
  const entries = [
    meta({ command: "npm test", originalChars: 50_000, compactChars: 1_000 }),
    meta({ id: "2", command: "npm test", originalChars: 30_000, compactChars: 1_000 }),
    meta({ id: "3", command: "git diff", profile: "git", originalChars: 20_000, compactChars: 18_000 }),
  ];
  const out = renderStats(entries);
  expect(out).toContain("3 run");
  expect(out).toContain("80%"); // 100k raw -> 20k left
  // git diff comes before the test command because it still occupies the most context after compression
  const gitIdx = out.indexOf("git diff");
  const testIdx = out.indexOf("npm test");
  expect(gitIdx).toBeGreaterThan(-1);
  expect(gitIdx).toBeLessThan(testIdx);
});

test("the pipeline writes one meta line to index.jsonl per run (above the pass-through threshold)", async () => {
  rmSync(ROOT, { recursive: true, force: true });
  // rawUnderChars: 0 = pass-through off - below the threshold the pipeline deliberately writes NO meta
  const cfg = { ...defaultConfig, run: { ...defaultConfig.run, rawUnderChars: 0 } };
  await runAndCompress(["sh", "-c", "echo hi"], cfg, () => "m1", ROOT);
  const all = readMeta(ROOT);
  expect(all.length).toBe(1);
  expect(all[0]!.id).toBe("m1");
  expect(all[0]!.profile).toBe("generic");
  expect(all[0]!.originalChars).toBeGreaterThan(0);
});
