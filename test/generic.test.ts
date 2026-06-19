import { test, expect } from "bun:test";
import { generic } from "../src/compressors/generic";
import type { CompressInput } from "../src/compressors/types";

const opts = { thresholdLines: 5, headLines: 2, tailLines: 1 };
const base = (stdout: string): CompressInput => ({ stdout, stderr: "", exitCode: 0, command: "x" });

test("dưới ngưỡng: giữ nguyên", () => {
  const r = generic(base("a\nb\nc"), opts);
  expect(r.text).toBe("a\nb\nc");
  expect(r.compactLines).toBe(3);
});

test("vượt ngưỡng: head + tail + dòng ẩn", () => {
  const r = generic(base("1\n2\n3\n4\n5\n6\n7\n8"), opts);
  expect(r.text.split("\n")[0]).toBe("1");
  expect(r.text).toContain("dòng đã ẩn");
  expect(r.text.split("\n").at(-1)).toBe("8");
  expect(r.originalLines).toBe(8);
});

test("head+tail >= total: giữ nguyên, không trùng dòng", () => {
  // threshold 3, head 3 + tail 3 = 6 >= 5 total
  const r = generic(base("1\n2\n3\n4\n5"), { thresholdLines: 3, headLines: 3, tailLines: 3 });
  expect(r.text).toBe("1\n2\n3\n4\n5");
  expect(r.compactLines).toBe(5);
  expect(r.text).not.toContain("dòng đã ẩn");
});
