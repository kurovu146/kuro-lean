import { type CompressInput, type CompressResult, joinOutput, countLines } from "./types";

const ISSUE_RE = /\b(error|warning)\b/i;

export function compressBuild(input: CompressInput): CompressResult {
  const combined = joinOutput(input);
  const total = countLines(combined);
  const issues = combined.split("\n").filter((l) => ISSUE_RE.test(l));

  if (input.exitCode === 0 && issues.length === 0) {
    const text = `✓ build OK (${total} dòng đã ẩn)`;
    return { text, originalLines: total, compactLines: 1 };
  }
  if (issues.length === 0) {
    return { text: combined, originalLines: total, compactLines: total, note: "no-issue-fallback" };
  }
  const text = issues.join("\n");
  return { text, originalLines: total, compactLines: issues.length };
}
