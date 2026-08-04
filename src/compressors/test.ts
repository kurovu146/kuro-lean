import { type CompressInput, type CompressResult, joinOutput, countLines } from "./types";

const FAIL_RE = /(FAIL|✕|✗|✘|×|\bfailed\b|\bpanic\b|not ok|AssertionError|Error:)/i;
const SUMMARY_RE = /(Tests?\s+\d+\s+passed|Tests?\s+\d+\s+failed|test result:|\d+ passing|\d+ passed)/i;
// Stack frames pointing into libraries (node_modules, node:internal…) — noise that doesn't help debug your own code.
const LIB_FRAME_RE = /^\s*(at |❯ ).*(node_modules\/|node:)/;

/** Collapse runs of ≥2 consecutive library frames into one counted line; user frames are kept. */
function squashLibFrames(lines: string[]): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length >= 2) {
      const indent = buf[0]!.match(/^\s*/)![0];
      out.push(`${indent}… (${buf.length} library frames hidden)`);
    } else {
      out.push(...buf);
    }
    buf = [];
  };
  for (const line of lines) {
    if (LIB_FRAME_RE.test(line)) {
      buf.push(line);
    } else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out;
}

export function compressTest(input: CompressInput): CompressResult {
  const combined = joinOutput(input);
  const lines = combined.split("\n");
  const total = countLines(combined);

  if (input.exitCode === 0) {
    const summary = lines.filter((l) => SUMMARY_RE.test(l)).at(-1);
    const text = summary?.trim() ?? `✓ tests passed (exit 0)`;
    return { text, originalLines: total, compactLines: countLines(text) };
  }

  // FAIL: keep everything from the first failure marker to the end + every summary line before it.
  const firstFail = lines.findIndex((l) => FAIL_RE.test(l));
  if (firstFail === -1) {
    return { text: combined, originalLines: total, compactLines: total, note: "no-marker-fallback" };
  }
  const summaryBefore = lines.slice(0, firstFail).filter((l) => SUMMARY_RE.test(l));
  const kept = [...summaryBefore, ...squashLibFrames(lines.slice(firstFail))].join("\n");
  return { text: kept, originalLines: total, compactLines: countLines(kept) };
}
