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

// index.jsonl exists only for statistics — trimmed periodically so it can't grow forever.
const META_MAX_LINES = 2000;
const META_KEEP_LINES = 1000;

/**
 * Append one metadata line for a run to <root>/index.jsonl (the data source for `kt stats`).
 * Best-effort: the trim step is a non-atomic read-modify-write — two concurrent kt runs can drop a few
 * statistics lines. Acceptable, because these are only numbers, not the original logs.
 */
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

/** Read all metadata; corrupt lines are skipped. */
export function readMeta(root: string = DEFAULT_ROOT): RunMeta[] {
  const path = join(root, "index.jsonl");
  if (!existsSync(path)) return [];
  const out: RunMeta[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      // numeric fields must really be numbers — one misshapen entry (schema drift/partial write) turns all stats into NaN
      if (e && typeof e.id === "string" && Number.isFinite(e.originalChars) && Number.isFinite(e.compactChars)) {
        out.push(e);
      }
    } catch {
      // corrupt line → skip
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
  // guard against duplicate ids (two runs in the same millisecond) → add a suffix rather than overwrite
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
