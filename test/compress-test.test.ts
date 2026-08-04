import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { compressTest } from "../src/compressors/test";
import type { CompressInput } from "../src/compressors/types";

const fx = (name: string) => readFileSync(`test/fixtures/${name}`, "utf8");

test("pass => one summary line, no per-test detail", () => {
  const input: CompressInput = { stdout: fx("vitest-pass.txt"), stderr: "", exitCode: 0, command: "vitest run" };
  const r = compressTest(input);
  expect(r.compactLines).toBeLessThanOrEqual(2);
  expect(r.text).toContain("8 passed");
});

test("fail => KEEP the whole error block", () => {
  const input: CompressInput = { stdout: fx("vitest-fail.txt"), stderr: "", exitCode: 1, command: "vitest run" };
  const r = compressTest(input);
  expect(r.text).toContain("AssertionError: expected 4 to be 5");
  expect(r.text).toContain("FAIL");
  expect(r.text).toContain("src/b.test.ts:12:20");
});

test("fail => a run of consecutive node_modules/node:internal frames collapses to one line", () => {
  const stdout = [
    "FAIL src/calc.test.ts > cộng",
    "AssertionError: expected 4 to be 5",
    "    at src/calc.test.ts:12:20",
    "    at Object.eq (/app/node_modules/expect/build/index.js:123:9)",
    "    at run (/app/node_modules/jest-circus/build/run.js:25:9)",
    "    at node:internal/process/task_queues:95:5",
    "Tests: 1 failed",
  ].join("\n");
  const r = compressTest({ stdout, stderr: "", exitCode: 1, command: "jest" });
  expect(r.text).toContain("at src/calc.test.ts:12:20"); // our own frame: kept
  expect(r.text).not.toContain("node_modules/expect");
  expect(r.text).not.toContain("node:internal");
  expect(r.text).toContain("(3 library frames hidden)");
  expect(r.text).toContain("Tests: 1 failed");
});

test("fail => a lone library frame is kept as is (collapsing needs a run)", () => {
  const stdout = [
    "FAIL x",
    "Error: boom",
    "    at node_modules/lib/a.js:1:1",
    "    at src/mine.ts:2:2",
  ].join("\n");
  const r = compressTest({ stdout, stderr: "", exitCode: 1, command: "jest" });
  expect(r.text).toContain("node_modules/lib/a.js:1:1");
  expect(r.text).toContain("at src/mine.ts:2:2");
});
