import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const DEFAULT_ROOT = ".kt/runs";

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
  const path = join(root, `${id}.log`);
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
