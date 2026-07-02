import { execSync } from "child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import { readMeta } from "./store";

export interface StatuslineInput {
  cwd?: string;
  session_id?: string;
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
  todos: { done: number; total: number } | null;
  quota: string | null; // đã format sẵn (vd "⏳ 3h 12m left (40% used)")
  plan: string | null;
  cost?: number | null; // cost của riêng phiên hiện tại (reset khi /clear); undefined => fallback input.cost
  savedTokens?: number | null; // token kt đã tiết kiệm (từ .kt/runs/index.jsonl); null/0 => ẩn
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
  return cw.used_percentage ?? undefined;
}

function ctxLabel(size: number): string {
  if (size >= 900_000) return "(1M context)";
  if (size >= 200_000) return "(200K)";
  return "";
}

/**
 * Render statusline (PURE). Dòng 1 từ `input`; dòng 2-3 từ `extras`.
 * Không truyền extras => chỉ render dòng 1.
 * Layout 3 dòng ngang statusline.cjs:
 *   L1: dot model (label) · bar % · ~tok · ⏳quota · $cost
 *   L2: 📁 dir · 🌿 branch ↑↓ · 📋 plan
 *   L3: 📝 +/- · ✅ todo · 🔧 tools
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

  const dot = pct == null ? "⚪" : pct >= cfg.dangerPct ? "🔴" : pct >= cfg.warnPct ? "🟡" : "🟢";
  const model = input.model?.display_name ?? input.model?.id ?? "Claude";
  const label = ctxLabel(size);
  // display_name của Claude Code đôi khi đã kèm sẵn nhãn (vd "Opus 4.8 (1M context)") → tránh lặp.
  const showLabel = !!label && !/\(\s*\d+\s*[KM]\b[^)]*\)/.test(model);

  // L1
  const l1: string[] = [`${dot} ${model}${showLabel ? " " + label : ""}`];
  if (pct != null) l1.push(`${bar(pct)} ${pct}%`);
  if (tokens > 0) l1.push(`~${Math.round(tokens / 1000)}k tok`);
  if (extras?.quota) l1.push(extras.quota);
  // Ưu tiên cost đã neo theo phiên (reset khi /clear); fallback total tích luỹ từ Claude Code.
  const cost = extras?.cost ?? input.cost?.total_cost_usd;
  if (cost != null) l1.push(`$${cost.toFixed(2)}`);
  const lines = [l1.join(" · ")];

  if (extras) {
    // L2: dir · branch · plan
    const l2: string[] = [`📁 ${homify(extras.dir)}`];
    if (extras.git?.branch) {
      let b = `🌿 ${extras.git.branch}`;
      if (extras.git.ahead) b += ` ↑${extras.git.ahead}`;
      if (extras.git.behind) b += ` ↓${extras.git.behind}`;
      l2.push(b);
    }
    if (extras.plan) l2.push(`📋 ${extras.plan}`);
    lines.push(l2.join(" · "));

    // L3: diff · todo · tools (chỉ khi có ít nhất 1)
    const l3: string[] = [];
    if (extras.git && (extras.git.added || extras.git.removed)) {
      l3.push(`📝 +${extras.git.added} -${extras.git.removed}`);
    }
    if (extras.todos) l3.push(`✅ ${extras.todos.done}/${extras.todos.total}`);
    if (extras.tools > 0) l3.push(`🔧 ${extras.tools} tools`);
    if (extras.savedTokens) {
      const t = extras.savedTokens;
      l3.push(`♻️ ~${t >= 1000 ? `${Math.round(t / 1000)}k` : t} saved`);
    }
    if (l3.length) lines.push(l3.join(" · "));
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

// Statusline render rất thường xuyên, mỗi lần là 1 process kt mới → cache file ngắn hạn
// để khỏi spawn 6 lệnh git mỗi render. TTL ngắn nên vẫn đủ tươi cho diff chưa stage.
const GIT_CACHE_TTL_MS = 1500;

export function collectGit(cwd: string, now: number = Date.now()): GitInfo | null {
  const key = createHash("md5").update(cwd).digest("hex").slice(0, 8);
  const cachePath = join(tmpdir(), `kt-git-${key}.json`);
  try {
    const c = JSON.parse(readFileSync(cachePath, "utf8"));
    if (typeof c.ts === "number" && now - c.ts < GIT_CACHE_TTL_MS) return c.git ?? null;
  } catch {}

  const info = computeGit(cwd);
  try {
    writeFileSync(cachePath, JSON.stringify({ ts: now, git: info }));
  } catch {}
  return info;
}

function computeGit(cwd: string): GitInfo | null {
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

/** Parse transcript JSONL: đếm tool_use + lấy TODO mới nhất. Cache theo mtime ở tmpdir. */
export function parseTranscript(transcriptPath?: string): { tools: number; todos: { done: number; total: number } | null } {
  if (!transcriptPath || !existsSync(transcriptPath)) return { tools: 0, todos: null };
  let mtime: number;
  try {
    mtime = statSync(transcriptPath).mtimeMs;
  } catch {
    return { tools: 0, todos: null };
  }
  const key = createHash("md5").update(transcriptPath).digest("hex").slice(0, 8);
  const cachePath = join(tmpdir(), `kt-tr-${key}.json`);
  try {
    const c = JSON.parse(readFileSync(cachePath, "utf8"));
    if (c.mtime === mtime && typeof c.tools === "number") return { tools: c.tools, todos: c.todos ?? null };
  } catch {}

  let tools = 0;
  let rawTodos: any[] | null = null;
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
      for (const item of content) {
        if (item?.type !== "tool_use") continue;
        tools += 1;
        if (item.name === "TodoWrite" && Array.isArray(item.input?.todos)) rawTodos = item.input.todos;
      }
    }
  } catch {}

  const todos =
    Array.isArray(rawTodos) && rawTodos.length
      ? { done: rawTodos.filter((t) => t.status === "completed").length, total: rawTodos.length }
      : null;
  try {
    writeFileSync(cachePath, JSON.stringify({ mtime, tools, todos }));
  } catch {}
  return { tools, todos };
}

function fmtMsLeft(ms: number): string {
  if (ms < 0) return "";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m left`;
  return `${Math.floor(m / 60)}h ${m % 60}m left`;
}

/** Quota 5h từ cache CK-stack (nếu có). `now` injectable để test. */
export function readQuota(now: number = Date.now()): string | null {
  try {
    const q = JSON.parse(readFileSync(join(tmpdir(), "ck-usage-limits-cache.json"), "utf8"));
    if (!q || q.status === "unavailable") return null;
    const resetsAt = q.resets_at_ms ?? q.resetsAtMs;
    const pct = q.percent_used ?? q.percentUsed;
    if (!resetsAt) return null;
    const lbl = fmtMsLeft(resetsAt - now);
    if (!lbl) return null;
    const tail = pct != null ? ` (${pct}% used)` : "";
    return `⏳ ${lbl}${tail}`;
  } catch {
    return null;
  }
}

/** Active plan từ cache CK-stack theo session (nếu có). */
export function readActivePlan(sessionId?: string): string | null {
  if (!sessionId) return null;
  try {
    const st = JSON.parse(readFileSync(join(tmpdir(), `ck-session-${sessionId}.json`), "utf8"));
    const p = st?.plan?.name ?? st?.activePlan ?? st?.plan ?? null;
    return typeof p === "string" ? p : null;
  } catch {
    return null;
  }
}

/**
 * Cost của RIÊNG phiên hiện tại. `total_cost_usd` Claude Code gửi là tích luỹ theo cả
 * lần chạy CLI nên `/clear` không reset nó. Ta neo `baseline` theo conversation
 * (định danh bằng transcript_path); khi conversation đổi (do /clear) hoặc total tụt
 * (Claude tự reset) thì tái-neo → hiển thị `total - baseline`, bắt đầu lại từ ~0.
 */
export function sessionCost(input: StatuslineInput): number | undefined {
  const total = input.cost?.total_cost_usd;
  if (total === undefined) return undefined;
  const key = createHash("md5").update(input.session_id || "default").digest("hex").slice(0, 8);
  const statePath = join(tmpdir(), `kt-cost-${key}.json`);
  const transcript = input.transcript_path ?? "";
  try {
    const st = JSON.parse(readFileSync(statePath, "utf8"));
    if (st?.transcriptPath === transcript && typeof st.baseline === "number" && total >= st.baseline) {
      return total - st.baseline;
    }
  } catch {}
  // conversation mới / đổi transcript (clear) / total tụt → neo lại baseline, cost về 0
  try {
    writeFileSync(statePath, JSON.stringify({ transcriptPath: transcript, baseline: total }));
  } catch {}
  return 0;
}

/**
 * Token kt đã tiết kiệm cho project này (đọc .kt/runs/index.jsonl — cùng nguồn với `kt stats`).
 * index.jsonl tự trim nên đây là "tiết kiệm gần đây", không phải per-session. Token ≈ chars/4.
 */
export function collectSavedTokens(cwd: string): number | null {
  try {
    const entries = readMeta(join(cwd, ".kt", "runs"));
    if (entries.length === 0) return null;
    const chars = entries.reduce((s, e) => s + Math.max(0, e.originalChars - e.compactChars), 0);
    return Math.round(chars / 4);
  } catch {
    return null;
  }
}

export function collectExtras(input: StatuslineInput): Extras {
  const dir = input.cwd || process.cwd();
  const { tools, todos } = parseTranscript(input.transcript_path);
  return {
    dir,
    git: collectGit(dir),
    tools,
    todos,
    quota: readQuota(),
    plan: readActivePlan(input.session_id),
    cost: sessionCost(input),
    savedTokens: collectSavedTokens(dir),
  };
}
