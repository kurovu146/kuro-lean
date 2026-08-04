export interface CompressInput {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
}

export interface CompressResult {
  text: string;
  originalLines: number;
  compactLines: number;
  note?: string;
}

export interface GenericOpts {
  thresholdLines: number;
  headLines: number;
  tailLines: number;
}

export type Compressor = (input: CompressInput, opts?: GenericOpts) => CompressResult;

/** Merge stdout + stderr, dropping the trailing newline of each part. */
export function joinOutput(i: CompressInput): string {
  return [i.stdout, i.stderr]
    .map((s) => s.replace(/\n+$/, ""))
    .filter((s) => s.length > 0)
    .join("\n");
}

export function countLines(s: string): number {
  return s.length === 0 ? 0 : s.split("\n").length;
}

/**
 * The hard character cap, applied AFTER every compressor — the backstop for cases that slip past
 * line counting (one giant minified/JSON line, a failing test kept whole). Keeps the head (65%) and
 * the tail, replacing the middle with a marker pointing at `kt show`. maxChars <= 0 disables the cap.
 */
export function capChars(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length <= maxChars) return text;
  let head = Math.floor(maxChars * 0.65);
  // never cut inside a surrogate pair (emoji/astral characters) → step back/forward one unit
  const c = text.charCodeAt(head - 1);
  if (c >= 0xd800 && c <= 0xdbff) head -= 1;
  let cutStart = text.length - (maxChars - head);
  const t = text.charCodeAt(cutStart);
  if (t >= 0xdc00 && t <= 0xdfff) cutStart += 1;
  const hiddenKb = Math.round((cutStart - head) / 1024);
  return `${text.slice(0, head)}\n… [~${hiddenKb}KB trimmed — kt show] …\n${text.slice(cutStart)}`;
}
