import { type CompressInput, type CompressResult, joinOutput, countLines } from "./types";
import { generic } from "./generic";

export function compressGit(
  input: CompressInput,
  opts = { thresholdLines: 40, headLines: 15, tailLines: 10 },
): CompressResult {
  const combined = joinOutput(input);
  const total = countLines(combined);

  if (!/diff --git/.test(combined)) {
    // status/log: let generic handle it (small output is left alone)
    return generic(input, opts);
  }

  // A small diff → keep it VERBATIM (Claude usually runs `git diff` to READ the changes).
  // Only summarise to a shortstat for large diffs, otherwise it backfires (content lost → run it again).
  if (total <= opts.thresholdLines) {
    return { text: combined, originalLines: total, compactLines: total };
  }

  // Large diff: group by file, count +/-
  const files: { path: string; add: number; del: number }[] = [];
  let cur: { path: string; add: number; del: number } | null = null;
  for (const line of combined.split("\n")) {
    const m = line.match(/^diff --git a\/(.+?) b\//);
    if (m) {
      cur = { path: m[1]!, add: 0, del: 0 };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) cur.add++;
    else if (line.startsWith("-") && !line.startsWith("---")) cur.del++;
  }
  const text = files.map((f) => `${f.path}  +${f.add} -${f.del}`).join("\n");
  return { text, originalLines: total, compactLines: files.length };
}
