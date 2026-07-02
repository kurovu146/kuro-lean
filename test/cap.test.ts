import { test, expect } from "bun:test";
import { compress } from "../src/compressors";
import { capChars, type CompressInput } from "../src/compressors/types";
import { defaultConfig } from "../src/config";

test("capChars: dưới trần => giữ nguyên", () => {
  expect(capChars("ngắn", 100)).toBe("ngắn");
});

test("capChars: maxChars <= 0 => tắt cap, giữ nguyên", () => {
  const text = "x".repeat(50_000);
  expect(capChars(text, 0)).toBe(text);
});

test("capChars: vượt trần => giữ đầu + cuối + marker kt show", () => {
  const text = "A".repeat(10_000) + "B".repeat(10_000);
  const out = capChars(text, 8_000);
  expect(out.length).toBeLessThan(8_200); // trần + marker
  expect(out.startsWith("A")).toBe(true);
  expect(out.endsWith("B")).toBe(true);
  expect(out).toContain("kt show");
});

test("capChars: không cắt giữa surrogate pair (emoji) => không sinh lone surrogate", () => {
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
  const text = "😀".repeat(10_000); // mỗi emoji = 2 code unit
  const out = capChars(text, 8_001); // trần lẻ → điểm cắt rơi giữa pair nếu không chỉnh
  expect(hasLoneSurrogate(out)).toBe(false);
});

test("compress: 1 dòng khổng lồ lọt qua generic (1 dòng ≤ thresholdLines) vẫn bị cap", () => {
  const input: CompressInput = { stdout: "x".repeat(100_000), stderr: "", exitCode: 0, command: "curl api" };
  const r = compress("generic", input, defaultConfig);
  expect(r.text.length).toBeLessThan(defaultConfig.limits.maxChars + 200);
  expect(r.text).toContain("kt show");
});

test("compress: test fail rất dài bị cap nhưng vẫn giữ marker lỗi đầu tiên", () => {
  const big = "FAIL src/a.test.ts > case 1\n" + "trace line at something\n".repeat(20_000);
  const input: CompressInput = { stdout: big, stderr: "", exitCode: 1, command: "npm test" };
  const r = compress("test", input, defaultConfig);
  expect(r.text.length).toBeLessThan(defaultConfig.limits.maxChars + 200);
  expect(r.text).toContain("FAIL src/a.test.ts");
});
