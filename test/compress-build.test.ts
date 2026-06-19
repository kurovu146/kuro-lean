import { test, expect } from "bun:test";
import { compressBuild } from "../src/compressors/build";
import type { CompressInput } from "../src/compressors/types";

test("build OK => 1 dòng", () => {
  const input: CompressInput = {
    stdout: "compiling...\nlinking...\nwrote dist/index.js\ndone in 2s",
    stderr: "", exitCode: 0, command: "tsc -p .",
  };
  const r = compressBuild(input);
  expect(r.compactLines).toBe(1);
  expect(r.text).toContain("OK");
});

test("có error => giữ dòng error", () => {
  const input: CompressInput = {
    stdout: "compiling...\nsrc/a.ts(3,5): error TS2304: Cannot find name 'x'.\nmore noise\nmore noise",
    stderr: "", exitCode: 2, command: "tsc -p .",
  };
  const r = compressBuild(input);
  expect(r.text).toContain("error TS2304");
  expect(r.text).not.toContain("more noise");
});
