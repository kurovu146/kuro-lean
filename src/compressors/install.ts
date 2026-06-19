import { type CompressInput, type CompressResult, joinOutput, countLines } from "./types";

const KEEP_RE = /\b(added|removed|changed|audited|packages|warn|error|deprecated|peer|vulnerabilit)/i;

export function compressInstall(input: CompressInput): CompressResult {
  const combined = joinOutput(input);
  const total = countLines(combined);
  if (input.exitCode !== 0) {
    return { text: combined, originalLines: total, compactLines: total, note: "install-fail-fallback" };
  }
  const lines = combined.split("\n");
  const kept = lines.filter((l) => KEEP_RE.test(l));
  const lastLine = lines.at(-1);
  if (lastLine && lastLine.trim() && !kept.includes(lastLine)) kept.push(lastLine);
  const text = kept.length ? kept.join("\n") : combined;
  return { text, originalLines: total, compactLines: countLines(text) };
}
