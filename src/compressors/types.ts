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

/**
 * Trần ký tự tuyệt đối, áp SAU mọi compressor — chốt chặn cho các ca lọt lưới đếm-dòng
 * (1 dòng JSON/minified khổng lồ, test fail giữ nguyên khối). Giữ đầu (65%) + cuối,
 * phần giữa thay bằng marker trỏ tới `kt show`. maxChars <= 0 nghĩa là tắt cap.
 */
export function capChars(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length <= maxChars) return text;
  let head = Math.floor(maxChars * 0.65);
  // không cắt giữa surrogate pair (emoji/ký tự astral) → lùi/tiến 1 đơn vị
  const c = text.charCodeAt(head - 1);
  if (c >= 0xd800 && c <= 0xdbff) head -= 1;
  let cutStart = text.length - (maxChars - head);
  const t = text.charCodeAt(cutStart);
  if (t >= 0xdc00 && t <= 0xdfff) cutStart += 1;
  const hiddenKb = Math.round((cutStart - head) / 1024);
  return `${text.slice(0, head)}\n… [đã cắt ~${hiddenKb}KB — kt show] …\n${text.slice(cutStart)}`;
}
