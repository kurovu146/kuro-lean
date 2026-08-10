import { test, expect } from "bun:test";
import { compress } from "../src/compressors";
import { defaultConfig } from "../src/config";
import type { CompressInput } from "../src/compressors/types";

test("profile disabled => generic", () => {
  const cfg = { ...defaultConfig, profiles: { ...defaultConfig.profiles, test: false } };
  const input: CompressInput = { stdout: "a\nb", stderr: "", exitCode: 0, command: "npm test" };
  const r = compress("test", input, cfg);
  expect(r.text).toBe("a\nb"); // generic below the threshold is untouched
});

test("routes to the right compressor: a build with an error => keep the error line", () => {
  const input: CompressInput = {
    stdout: "noise\nsrc/a.ts(3,5): error TS2304: Cannot find name 'x'.\nnoise",
    stderr: "", exitCode: 2, command: "tsc -p .",
  };
  const r = compress("build", input, defaultConfig);
  expect(r.text).toContain("error TS2304");
  expect(r.text).not.toContain("noise");
});
