import { test, expect } from "bun:test";
import { compress } from "../src/compressors";
import { capChars, type CompressInput } from "../src/compressors/types";
import { defaultConfig } from "../src/config";

test("capChars: below the cap => untouched", () => {
  expect(capChars("short", 100)).toBe("short");
});

test("capChars: maxChars <= 0 => cap disabled, untouched", () => {
  const text = "x".repeat(50_000);
  expect(capChars(text, 0)).toBe(text);
});

test("capChars: over the cap => head + tail + a kt show marker", () => {
  const text = "A".repeat(10_000) + "B".repeat(10_000);
  const out = capChars(text, 8_000);
  expect(out.length).toBeLessThan(8_200); // cap + marker
  expect(out.startsWith("A")).toBe(true);
  expect(out.endsWith("B")).toBe(true);
  expect(out).toContain("kt show");
});

test("capChars: never cuts inside a surrogate pair (emoji) => no lone surrogate", () => {
  const hasLoneSurrogate = (s: string): boolean => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const n = s.charCodeAt(i + 1);
        if (!(n >= 0xdc00 && n <= 0xdfff)) return true;
        i++;
      } else if (c >= 0xdc00 && c <= 0xdfff) return true;
    }
    return false;
  };
  const text = "😀".repeat(10_000); // each emoji = 2 code units
  const out = capChars(text, 8_001); // an odd cap -> the cut lands mid-pair unless adjusted
  expect(hasLoneSurrogate(out)).toBe(false);
});

test("compress: one giant line slips past generic (1 line <= thresholdLines) but is still capped", () => {
  const input: CompressInput = { stdout: "x".repeat(100_000), stderr: "", exitCode: 0, command: "curl api" };
  const r = compress("generic", input, defaultConfig);
  expect(r.text.length).toBeLessThan(defaultConfig.limits.maxChars + 200);
  expect(r.text).toContain("kt show");
});

test("compress: a very long failing test is capped but keeps the first error marker", () => {
  const big = "FAIL src/a.test.ts > case 1\n" + "trace line at something\n".repeat(20_000);
  const input: CompressInput = { stdout: big, stderr: "", exitCode: 1, command: "npm test" };
  const r = compress("test", input, defaultConfig);
  expect(r.text.length).toBeLessThan(defaultConfig.limits.maxChars + 200);
  expect(r.text).toContain("FAIL src/a.test.ts");
});
