import { execSync } from "child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";

export interface StatuslineInput {
  cwd?: string;
  transcript_path?: string;
  model?: { id?: string; display_name?: string };
  context_window?: {
    used_percentage?: number;
    total_input_tokens?: number;
    total_output_tokens?: number;
    context_window_size?: number;
    current_usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  cost?: { total_cost_usd?: number };
}

export interface GitInfo {
  branch: string;
  ahead: number;
  behind: number;
  added: number;
  removed: number;
}

export interface Extras {
  dir: string;
  git: GitInfo | null;
  tools: number;
}

// Đệm autocompact — khớp cách Claude Code tính % trong /context.
const AUTOCOMPACT_BUFFER = 45000;

function bar(pct: number, width = 10): string {
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((width * p) / 100);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

function homify(p: string): string {
  const home = homedir();
  return p && p.startsWith(home) ? "~" + p.slice(home.length) : p || "";
}

type CtxWindow = NonNullable<StatuslineInput["context_window"]>;

/** Tổng token đang chiếm context (ưu tiên current_usage như /context). */
function totalTokens(cw: CtxWindow): number {
  const u = cw.current_usage;
  if (u) {
    return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  }
  return (cw.total_input_tokens ?? 0) + (cw.total_output_tokens ?? 0);
}

/** % context — công thức /context (current_usage + buffer)/size; fallback used_percentage. */
function ctxPercent(cw: CtxWindow): number | undefined {
  const size = cw.context_window_size ?? 0;
  if (cw.current_usage && size > AUTOCOMPACT_BUFFER) {
    const total = totalTokens(cw);
    return Math.min(100, Math.round(((total + AUTOCOMPACT_BUFFER) / size) * 100));
  }
  return cw.used_percentage;
}

function ctxLabel(size: number): string {
  if (size >= 900_000) return "(1M context)";
  if (size >= 200_000) return "(200K)";
  return "";
}

/**
 * Render statusline (PURE). Dòng 1 từ `input`; dòng 2 (dir/git/tools) từ `extras`.
 * Không truyền extras => chỉ render dòng 1.
 */
export function renderStatusline(
  input: StatuslineInput,
  cfg: { warnPct: number; dangerPct: number },
  extras?: Extras,
): string {
  const cw = input.context_window ?? {};
  const size = cw.context_window_size ?? 0;
  const pct = ctxPercent(cw);
  const tokens = totalTokens(cw);

  const dot = pct === undefined ? "⚪" : pct >= cfg.dangerPct ? "🔴" : pct >= cfg.warnPct ? "🟡" : "🟢";
  const model = input.model?.display_name ?? input.model?.id ?? "Claude";
  const label = ctxLabel(size);

  // Dòng 1: dot model (label) · bar pct% · ~Nk tok · $cost
  const l1: string[] = [`${dot} ${model}${label ? " " + label : ""}`];
  if (pct !== undefined) l1.push(`${bar(pct)} ${pct}%`);
  if (tokens > 0) l1.push(`~${Math.round(tokens / 1000)}k tok`);
  if (input.cost?.total_cost_usd !== undefined) l1.push(`$${input.cost.total_cost_usd.toFixed(2)}`);
  const lines = [l1.join(" · ")];

  // Dòng 2: 📁 dir · 🌿 branch ↑↓ · 📝 +/- · 🔧 tools
  if (extras) {
    const l2: string[] = [`📁 ${homify(extras.dir)}`];
    if (extras.git?.branch) {
      let b = `🌿 ${extras.git.branch}`;
      if (extras.git.ahead) b += ` ↑${extras.git.ahead}`;
      if (extras.git.behind) b += ` ↓${extras.git.behind}`;
      l2.push(b);
    }
    if (extras.git && (extras.git.added || extras.git.removed)) {
      l2.push(`📝 +${extras.git.added} -${extras.git.removed}`);
    }
    if (extras.tools > 0) l2.push(`🔧 ${extras.tools} tools`);
    if (l2.length > 1) lines.push(l2.join(" · "));
  }

  return lines.join("\n");
}

// ---- Thu thập I/O (không pure) — dùng bởi cli, không gọi trong test render ----

const GIT_ALLOWED = new Set([
  "git rev-parse --git-dir",
  "git branch --show-current",
  "git rev-parse --short HEAD",
  "git diff --shortstat",
  "git diff --cached --shortstat",
  "git rev-list --left-right --count @{u}...HEAD",
]);

function gitRun(cmd: string, cwd: string): string {
  if (!GIT_ALLOWED.has(cmd)) return "";
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf8",
      timeout: 1500,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
  } catch {
    return "";
  }
}

function parseShortstat(s: string): { added: number; removed: number } {
  return {
    added: parseInt((s.match(/(\d+) insertion/) ?? [])[1] ?? "0", 10),
    removed: parseInt((s.match(/(\d+) deletion/) ?? [])[1] ?? "0", 10),
  };
}

export function collectGit(cwd: string): GitInfo | null {
  if (!gitRun("git rev-parse --git-dir", cwd)) return null;
  const branch =
    gitRun("git branch --show-current", cwd) || gitRun("git rev-parse --short HEAD", cwd);
  const unstaged = parseShortstat(gitRun("git diff --shortstat", cwd));
  const staged = parseShortstat(gitRun("git diff --cached --shortstat", cwd));
  let ahead = 0;
  let behind = 0;
  const ab = gitRun("git rev-list --left-right --count @{u}...HEAD", cwd);
  if (ab) {
    const [b, a] = ab.split(/\s+/);
    behind = parseInt(b ?? "0", 10) || 0;
    ahead = parseInt(a ?? "0", 10) || 0;
  }
  return { branch, ahead, behind, added: unstaged.added + staged.added, removed: unstaged.removed + staged.removed };
}

/** Đếm tool_use trong transcript JSONL; cache theo mtime ở tmpdir để khỏi parse lại. */
export function countTools(transcriptPath?: string): number {
  if (!transcriptPath || !existsSync(transcriptPath)) return 0;
  let mtime: number;
  try {
    mtime = statSync(transcriptPath).mtimeMs;
  } catch {
    return 0;
  }
  const key = createHash("md5").update(transcriptPath).digest("hex").slice(0, 8);
  const cachePath = join(tmpdir(), `kt-tr-${key}.json`);
  try {
    const c = JSON.parse(readFileSync(cachePath, "utf8"));
    if (c.mtime === mtime && typeof c.tools === "number") return c.tools;
  } catch {}

  let tools = 0;
  try {
    for (const line of readFileSync(transcriptPath, "utf8").split("\n")) {
      if (!line) continue;
      let evt: any;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      const content = evt?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const item of content) if (item?.type === "tool_use") tools += 1;
    }
  } catch {}

  try {
    writeFileSync(cachePath, JSON.stringify({ mtime, tools }));
  } catch {}
  return tools;
}

export function collectExtras(input: StatuslineInput): Extras {
  const dir = input.cwd || process.cwd();
  return { dir, git: collectGit(dir), tools: countTools(input.transcript_path) };
}
