import { type CompressInput, type CompressResult, type GenericOpts, joinOutput, countLines } from "./types";

const DEFAULT: GenericOpts = { thresholdLines: 0, headLines: 15, tailLines: 10 };

export function generic(input: CompressInput, opts: GenericOpts = DEFAULT): CompressResult {
  const combined = joinOutput(input);
  const total = countLines(combined);
  // thresholdLines <= 0: disables head/tail trimming — generic output (grep/sed/ls) often needs its
  // middle read, and trimming forces a `kt show` = an extra turn, costing more than it saves.
  // The character cap still catches the huge dumps.
  if (opts.thresholdLines <= 0 || total <= opts.thresholdLines) {
    return { text: combined, originalLines: total, compactLines: total };
  }
  if (opts.headLines + opts.tailLines >= total) {
    return { text: combined, originalLines: total, compactLines: total };
  }
  const lines = combined.split("\n");
  const head = lines.slice(0, opts.headLines);
  const tail = lines.slice(-opts.tailLines);
  const hidden = total - head.length - tail.length;
  const text = [...head, `… [${hidden} lines hidden — kt show] …`, ...tail].join("\n");
  return { text, originalLines: total, compactLines: head.length + tail.length + 1 };
}
