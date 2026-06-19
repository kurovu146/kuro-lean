import { type CompressInput, type CompressResult, joinOutput, countLines } from "./types";

const FAIL_RE = /(FAIL|✕|✗|✘|×|\bfailed\b|\bpanic\b|not ok|AssertionError|Error:)/i;
const SUMMARY_RE = /(Tests?\s+\d+\s+passed|Tests?\s+\d+\s+failed|test result:|\d+ passing|\d+ passed)/i;

export function compressTest(input: CompressInput): CompressResult {
  const combined = joinOutput(input);
  const lines = combined.split("\n");
  const total = countLines(combined);

  if (input.exitCode === 0) {
    const summary = lines.filter((l) => SUMMARY_RE.test(l)).at(-1);
    const text = summary?.trim() ?? `✓ tests passed (exit 0)`;
    return { text, originalLines: total, compactLines: countLines(text) };
  }

  // FAIL: giữ từ dấu hiệu lỗi đầu tiên tới cuối + mọi dòng summary phía trước.
  const firstFail = lines.findIndex((l) => FAIL_RE.test(l));
  if (firstFail === -1) {
    return { text: combined, originalLines: total, compactLines: total, note: "no-marker-fallback" };
  }
  const summaryBefore = lines.slice(0, firstFail).filter((l) => SUMMARY_RE.test(l));
  const kept = [...summaryBefore, ...lines.slice(firstFail)].join("\n");
  return { text: kept, originalLines: total, compactLines: countLines(kept) };
}
