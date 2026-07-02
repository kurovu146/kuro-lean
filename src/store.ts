import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, appendFileSync } from "fs";
import { join } from "path";

const DEFAULT_ROOT = ".kt/runs";

export interface RunMeta {
  id: string;
  command: string;
  profile: string;
  originalChars: number;
  compactChars: number;
}

// index.jsonl chỉ để thống kê — trim định kỳ cho khỏi phình vô hạn.
const META_MAX_LINES = 2000;
const META_KEEP_LINES = 1000;

/** Ghi 1 dòng metadata cho run vào <root>/index.jsonl (nguồn dữ liệu của `kt stats`). */
export function appendMeta(
  entry: RunMeta,
  opts: { root?: string; maxLines?: number; keepLines?: number } = {},
): void {
  const root = opts.root ?? DEFAULT_ROOT;
  mkdirSync(root, { recursive: true });
  const path = join(root, "index.jsonl");
  appendFileSync(path, JSON.stringify(entry) + "\n");
  const max = opts.maxLines ?? META_MAX_LINES;
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  if (lines.length > max) {
    writeFileSync(path, lines.slice(-(opts.keepLines ?? META_KEEP_LINES)).join("\n") + "\n");
  }
}

/** Đọc toàn bộ metadata; dòng hỏng bị bỏ qua. */
export function readMeta(root: string = DEFAULT_ROOT): RunMeta[] {
  const path = join(root, "index.jsonl");
  if (!existsSync(path)) return [];
  const out: RunMeta[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e.id === "string") out.push(e);
    } catch {
      // dòng hỏng → bỏ
    }
  }
  return out;
}

export function listRuns(root: string = DEFAULT_ROOT): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((f) => f.endsWith(".log"))
    .map((f) => f.slice(0, -4))
    .sort();
}

export function saveRun(id: string, content: string, opts: { keep?: number; root?: string } = {}): string {
  const root = opts.root ?? DEFAULT_ROOT;
  mkdirSync(root, { recursive: true });
  // chống trùng id (2 run cùng timestamp-ms) → thêm hậu tố thay vì ghi đè
  let path = join(root, `${id}.log`);
  for (let n = 1; existsSync(path); n++) path = join(root, `${id}-${n}.log`);
  writeFileSync(path, content);
  const keep = opts.keep ?? 50;
  const ids = listRuns(root);
  for (const old of ids.slice(0, Math.max(0, ids.length - keep))) {
    rmSync(join(root, `${old}.log`), { force: true });
  }
  return path;
}

export function showRun(id?: string, root: string = DEFAULT_ROOT): string | null {
  const target = id ?? listRuns(root).at(-1);
  if (!target) return null;
  const path = join(root, `${target}.log`);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}
