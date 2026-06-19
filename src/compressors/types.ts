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

/** Gộp stdout + stderr, bỏ newline thừa cuối từng phần. */
export function joinOutput(i: CompressInput): string {
  return [i.stdout, i.stderr]
    .map((s) => s.replace(/\n+$/, ""))
    .filter((s) => s.length > 0)
    .join("\n");
}

export function countLines(s: string): number {
  return s.length === 0 ? 0 : s.split("\n").length;
}
