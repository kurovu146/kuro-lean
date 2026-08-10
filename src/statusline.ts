import { execSync, spawn } from "child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { idleMinutes } from "./transcript";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import { readMeta } from "./store";
import { perTurnCost, priceOf, CACHE_WRITE_MULT, type PricingTable } from "./cost";
import { readWeekly, weeklyCachePath } from "./weekly";

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
  quota: string | null; // pre-formatted (e.g. "⏳ 3h 12m left · 📅 3d 14h left")
  plan: string | null;
  cost?: number | null; // cost of the current session only (resets on /clear); undefined => fall back to input.cost
  savedTokens?: number | null; // tokens kt has saved (from .kt/runs/index.jsonl); null/0 => hidden
  // USD to re-read the context on EVERY following turn (cache read). A growing context means
  // every Enter costs more, even when nothing new is loaded. null/0 => hidden.
  perTurn?: number | null;
  // How long it has been silent since the transcript was last written. Past the 1h TTL the cache is
  // dead and the next turn must reload the whole context (2× input price) — that is when `/clear`
  // is worth the most.
  idle?: { minutes: number; cacheAlive: boolean; reloadCost: number | null } | null;
  // The quota week's spend (e.g. "💵 wk $1.7k 2.7B"), served from a cache; null => hidden.
  weekly?: string | null;
}

// Below this, a pause isn't worth mentioning — don't clutter the status line.
const IDLE_SHOW_MIN = 10;
// The 1-hour cache TTL (Claude Code uses the 1h variant). See README → Where the money goes.
export const CACHE_TTL_MIN = 60;

export function fmtIdle(min: number): string {
  const m = Math.round(min);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

// Autocompact buffer — matches how Claude Code computes the percentage in /context.
const AUTOCOMPACT_BUFFER = 45000;

function bar(pct: number, width = 10): string {
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((width * p) / 100);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

function homify(p: string, home: string): string {
  return p && p.startsWith(home) ? "~" + p.slice(home.length) : p || "";
}

type CtxWindow = NonNullable<StatuslineInput["context_window"]>;

/** Total tokens occupying the context (prefers current_usage, like /context). */
function totalTokens(cw: CtxWindow): number {
  const u = cw.current_usage;
  if (u) {
    return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  }
  return (cw.total_input_tokens ?? 0) + (cw.total_output_tokens ?? 0);
}

/** Context % — the /context formula (current_usage + buffer)/size; falls back to used_percentage. */
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
 * Render the status line (PURE). Line 1 comes from `input`; lines 2-3 from `extras`.
 * Without extras, only line 1 is rendered.
 * The 3-line layout, matching statusline.cjs:
 *   L1: dot model (label) · bar % · ~tok · $cost
 *   L2: 📁 dir · 🌿 branch ↑↓ · 📋 plan
 *   L3: 📝 +/- · ✅ todo · 🔧 tools · ♻️ saved · 📅 quota · 💵 weekly
 */
export function renderStatusline(
  input: StatuslineInput,
  cfg: { warnPct: number; dangerPct: number },
  extras?: Extras,
  home: string = homedir(),
): string {
  const cw = input.context_window ?? {};
  const size = cw.context_window_size ?? 0;
  const pct = ctxPercent(cw);
  const tokens = totalTokens(cw);

  const dot = pct == null ? "⚪" : pct >= cfg.dangerPct ? "🔴" : pct >= cfg.warnPct ? "🟡" : "🟢";
  const model = input.model?.display_name ?? input.model?.id ?? "Claude";
  const label = ctxLabel(size);
  // Claude Code's display_name sometimes already carries the label (e.g. "Opus 4.8 (1M context)") → avoid repeating it.
  const showLabel = !!label && !/\(\s*\d+\s*[KM]\b[^)]*\)/.test(model);

  // L1
  const l1: string[] = [`${dot} ${model}${showLabel ? " " + label : ""}`];
  if (pct != null) l1.push(`${bar(pct)} ${pct}%`);
  if (tokens > 0) l1.push(`~${Math.round(tokens / 1000)}k tok`);
  // Prefer the session-anchored cost (resets on /clear); fall back to Claude Code's cumulative total.
  const cost = extras?.cost ?? input.cost?.total_cost_usd;
  if (cost != null) l1.push(`$${cost.toFixed(2)}`);
  if (extras?.perTurn) l1.push(`$${extras.perTurn.toFixed(2)}/turn`);
  const idle = extras?.idle;
  if (idle && idle.minutes >= IDLE_SHOW_MIN) {
    // Cache already dead => show the reload price, because this is exactly the moment to decide on /clear
    l1.push(
      idle.cacheAlive
        ? `🕐 ${fmtIdle(idle.minutes)}`
        : `❄️ ${fmtIdle(idle.minutes)}${idle.reloadCost ? ` · reload ~$${idle.reloadCost.toFixed(2)}` : ""}`,
    );
  }
  const lines = [l1.join(" · ")];

  if (extras) {
    // L2: dir · branch · plan
    const l2: string[] = [`📁 ${homify(extras.dir, home)}`];
    if (extras.git?.branch) {
      let b = `🌿 ${extras.git.branch}`;
      if (extras.git.ahead) b += ` ↑${extras.git.ahead}`;
      if (extras.git.behind) b += ` ↓${extras.git.behind}`;
      l2.push(b);
    }
    if (extras.plan) l2.push(`📋 ${extras.plan}`);
    lines.push(l2.join(" · "));

    // L3: diff · todo · tools (only when at least one exists)
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
    // Last: the quota clock sits at the end of L3, where the weekly-usage segment gets appended.
    if (extras.quota) l3.push(extras.quota);
    if (extras.weekly) l3.push(extras.weekly);
    if (l3.length) lines.push(l3.join(" · "));
  }

  return lines.join("\n");
}

// ---- I/O collection (not pure) — used by the CLI, never called from render tests ----

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

// The status line renders very often, each time as a fresh kt process → cache to a file briefly
// so we don't spawn 6 git commands per render. The TTL is short enough to stay fresh for unstaged diffs.
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

/** Parse the transcript JSONL: count tool_use + take the latest TODO. Cached by mtime in tmpdir. */
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

// Longest countdown that can be a real quota window. Claude Code caches a 5-hour and a 7-day one;
// anything past a quarter is not a window but a mis-parse — `resets_at: 12345` makes Date.parse read
// "year 12345", which is finite, positive, and 3,768,715 days long.
const MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function fmtMsLeft(ms: number): string {
  // Both ends are checked BEFORE the branches, because NaN fails every comparison there is: `ms < 0`
  // was false for it, so was `m < 60` and `h < 24`, and it fell through to the days branch and
  // rendered "NaNd NaNh left". Garbage must hide the segment, never print it.
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_WINDOW_MS) return "";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m left`;
  return `${Math.floor(h / 24)}d ${h % 24}h left`;
}

type UsageWindow = { resets_at?: string | null } | null | undefined;

/**
 * How long is left on the usage windows Claude Code caches in `~/.claude.json` →
 * `cachedUsageUtilization`: the 5-hour session window and the 7-day one.
 *
 * Countdowns only. The `utilization` percentages sitting next to them are a snapshot Claude Code
 * refetches on its own schedule - it read 36% for five hours while `/usage` said 43%, which is worse
 * than no number at all. `resets_at` is an absolute timestamp, so the countdown stays exact no matter
 * how old the snapshot is. `now` and the config path are injectable for tests.
 */
export function readQuota(
  now: number = Date.now(),
  configPath: string = join(homedir(), ".claude.json"),
): string | null {
  try {
    const u = JSON.parse(readFileSync(configPath, "utf8"))?.cachedUsageUtilization?.utilization;
    if (!u) return null;
    const seg = (icon: string, w: UsageWindow): string | null => {
      if (!w?.resets_at) return null;
      const lbl = fmtMsLeft(Date.parse(w.resets_at) - now); // "" once the window has reset => drop it
      return lbl ? `${icon} ${lbl}` : null;
    };
    const parts = [seg("⏳", u.five_hour), seg("📅", u.seven_day)].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  } catch {
    return null;
  }
}

/** The active plan from the per-session CK-stack cache (when present). */
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
 * The cost of THIS session alone. The `total_cost_usd` Claude Code sends accumulates across the whole
 * CLI run, so `/clear` doesn't reset it. We anchor a `baseline` per conversation (identified by
 * transcript_path); when the conversation changes (via /clear) or the total drops (Claude reset it),
 * we re-anchor → displaying `total - baseline`, starting from ~0 again.
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
  // New conversation / changed transcript (clear) / total dropped → re-anchor the baseline, cost back to 0
  try {
    writeFileSync(statePath, JSON.stringify({ transcriptPath: transcript, baseline: total }));
  } catch {}
  return 0;
}

/**
 * Tokens kt has saved for this project (reads .kt/runs/index.jsonl — the same source as `kt stats`).
 * index.jsonl self-trims, so this is "recent savings", not per-session. Tokens ≈ chars/4.
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

/**
 * How long it has been silent, measured from the last transcript write (mtime — cheap, and the status
 * line renders often). Past the TTL the cache is dead: the next turn must rewrite the whole context at
 * 2× the input price.
 */
export function collectIdle(
  input: StatuslineInput,
  pricing?: PricingTable,
  now: number = Date.now(),
): Extras["idle"] {
  const path = input.transcript_path;
  if (!path || !existsSync(path)) return null;
  // Time since the conversation last moved, not since the file was last written — bookkeeping entries
  // keep bumping mtime while the panel is idle, which made this read "warmer" than the cache really is.
  const minutes = idleMinutes(path, now);
  const cacheAlive = minutes < CACHE_TTL_MIN;
  const model = input.model?.id;
  const p = pricing && model ? priceOf(model, pricing) : null;
  const tokens = totalTokens(input.context_window ?? {});
  return {
    minutes,
    cacheAlive,
    reloadCost: p ? (tokens / 1e6) * p.input * CACHE_WRITE_MULT : null,
  };
}

/** Ask a detached `kt weekly --refresh` to rebuild the cache. Fire-and-forget: nothing is awaited. */
function spawnWeeklyRefresh(): void {
  try {
    const self = process.argv[1];
    if (!self) return;
    const child = spawn(process.execPath, [self, "weekly", "--refresh"], { detached: true, stdio: "ignore" });
    // posix_spawn failures (EMFILE, EACCES, ...) surface asynchronously on this event, after the
    // try/catch around spawn() has already exited - an unhandled one here takes the whole render
    // down. A background refresh that couldn't start must never crash the statusline.
    child.on("error", () => {});
    child.unref();
  } catch {}
}

/**
 * The cached weekly line, plus a detached rescan when it has aged out. The scan is ~0.5s — far too
 * slow to run inline on a line that redraws every turn — so this turn shows the previous value and
 * the next one shows the fresh figure.
 *
 * The clock, the cache path and the refresh itself are all injected. `enabled: false` is a promise
 * about someone else's machine — no segment AND no background process — and a promise that spawns a
 * real child on the way to being checked cannot be tested at all.
 */
export function collectWeekly(
  enabled: boolean,
  now: number = Date.now(),
  cachePath: string = weeklyCachePath(),
  refresh: () => void = spawnWeeklyRefresh,
): string | null {
  if (!enabled) return null;
  const { line, stale } = readWeekly(now, cachePath);
  if (stale) refresh();
  return line;
}

export function collectExtras(input: StatuslineInput, pricing?: PricingTable, weekly = true): Extras {
  const dir = input.cwd || process.cwd();
  const { tools, todos } = parseTranscript(input.transcript_path);
  const cw = input.context_window ?? {};
  const modelId = input.model?.id;
  return {
    dir,
    git: collectGit(dir),
    tools,
    todos,
    quota: readQuota(),
    plan: readActivePlan(input.session_id),
    cost: sessionCost(input),
    savedTokens: collectSavedTokens(dir),
    // needs the model *id* (e.g. claude-opus-5) — display_name ("Opus 5") doesn't match the price table.
    perTurn: pricing && modelId ? perTurnCost(totalTokens(cw), modelId, pricing) : null,
    idle: collectIdle(input, pricing),
    weekly: collectWeekly(weekly),
  };
}
