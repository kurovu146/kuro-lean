import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { compressTest } from "../src/compressors/test";
import type { CompressInput } from "../src/compressors/types";

const fx = (name: string) => readFileSync(`test/fixtures/${name}`, "utf8");

test("pass => 1 dòng summary, không kèm chi tiết test", () => {
  const input: CompressInput = { stdout: fx("vitest-pass.txt"), stderr: "", exitCode: 0, command: "vitest run" };
  const r = compressTest(input);
  expect(r.compactLines).toBeLessThanOrEqual(2);
  expect(r.text).toContain("8 passed");
});

test("fail => GIỮ block lỗi đầy đủ", () => {
  const input: CompressInput = { stdout: fx("vitest-fail.txt"), stderr: "", exitCode: 1, command: "vitest run" };
  const r = compressTest(input);
  expect(r.text).toContain("AssertionError: expected 4 to be 5");
  expect(r.text).toContain("FAIL");
  expect(r.text).toContain("src/b.test.ts:12:20");
});
