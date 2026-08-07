import { test, expect } from "bun:test";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import { renderStatusline, collectGit, sessionCost, collectSavedTokens, type Extras } from "../src/statusline";
import { appendMeta } from "../src/store";
import { rmSync, mkdirSync } from "fs";

const cfg = { warnPct: 60, dangerPct: 85 };
// the home to shorten against is injected, never homedir() - on CI that is /home/runner
const HOME = "/Users/kuro";

test("below warn => green + tokens + cost", () => {
  const s = renderStatusline(
    { context_window: { used_percentage: 42, total_input_tokens: 80000, total_output_tokens: 4000, context_window_size: 200000 }, model: { display_name: "Opus" }, cost: { total_cost_usd: 0.31 } },
    cfg,
  );
  expect(s).toContain("🟢");
  expect(s).toContain("42%");
  expect(s).toContain("84k");
  expect(s).toContain("$0.31");
});

test("at or above danger => red", () => {
  const s = renderStatusline({ context_window: { used_percentage: 90, context_window_size: 200000 } }, cfg);
  expect(s).toContain("🔴");
});

test("missing fields => no crash", () => {
  const s = renderStatusline({}, cfg);
  expect(typeof s).toBe("string");
});

test("ctx% the /context way (current_usage + buffer) + the 1M label", () => {
  const s = renderStatusline(
    {
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 1_000_000,
        current_usage: { input_tokens: 100000, cache_creation_input_tokens: 50000, cache_read_input_tokens: 200000 },
      },
    },
    cfg,
  );
  // (100000+50000+200000+45000)/1_000_000 = 39.5% -> 40%
  expect(s).toContain("40%");
  expect(s).toContain("(1M context)");
  expect(s).toContain("▰"); // the bar is there
});

test("200K label when size = 200000", () => {
  const s = renderStatusline({ context_window: { used_percentage: 10, context_window_size: 200000 } }, cfg);
  expect(s).toContain("(200K)");
});

test("display_name already carries the label => don't repeat it", () => {
  const s = renderStatusline(
    {
      model: { display_name: "Opus 4.8 (1M context)" },
      context_window: { used_percentage: 10, context_window_size: 1_000_000 },
    },
    cfg,
  );
  // appears exactly once, never as "(1M context) (1M context)"
  expect(s.match(/\(1M context\)/g)?.length).toBe(1);
});

test("used_percentage = null (after /clear) => white dot, no 'null%'", () => {
  const s = renderStatusline(
    {
      model: { display_name: "Opus 4.8 (1M context)" },
      context_window: { used_percentage: null as any, context_window_size: 1_000_000 },
      cost: { total_cost_usd: 0 },
    },
    cfg,
  );
  expect(s).not.toContain("null");
  expect(s).toContain("⚪");
  expect(s).toContain("$0.00");
});

test("all 3 lines: quota(L1) · dir/branch/plan(L2) · diff/todo/tools(L3)", () => {
  const extras: Extras = {
    dir: `${HOME}/Dev/kuro-lean`,
    git: { branch: "main", ahead: 1, behind: 0, added: 12, removed: 3 },
    tools: 8,
    todos: { done: 2, total: 5 },
    quota: "⏳ 3h 12m left (40% used)",
    plan: "refactor-auth",
  };
  const s = renderStatusline(
    { context_window: { used_percentage: 10, context_window_size: 200000 }, cost: { total_cost_usd: 0.5 } },
    cfg,
    extras,
    HOME,
  );
  const [l1, l2, l3] = s.split("\n");
  // L1: quota comes before cost
  expect(l1).toContain("⏳ 3h 12m left (40% used)");
  expect(l1).toContain("$0.50");
  // L2
  expect(l2).toContain("📁 ~/Dev/kuro-lean");
  expect(l2).toContain("🌿 main");
  expect(l2).toContain("↑1");
  expect(l2).toContain("📋 refactor-auth");
  // L3
  expect(l3).toContain("📝 +12 -3");
  expect(l3).toContain("✅ 2/5");
  expect(l3).toContain("🔧 8 tools");
});

test("minimal extras (dir only) => L1 + L2(dir), no L3", () => {
  const extras: Extras = { dir: "/tmp/x", git: null, tools: 0, todos: null, quota: null, plan: null };
  const s = renderStatusline({ context_window: { used_percentage: 10, context_window_size: 200000 } }, cfg, extras);
  const lines = s.split("\n");
  expect(lines.length).toBe(2); // L1 + L2(dir); no L3 without diff/todo/tools
  expect(lines[1]).toContain("📁 /tmp/x");
});

test("extras.cost wins over input.cost (the session cost was reset)", () => {
  const extras: Extras = { dir: "/tmp/x", git: null, tools: 0, todos: null, quota: null, plan: null, cost: 0 };
  const s = renderStatusline(
    { context_window: { used_percentage: 10, context_window_size: 200000 }, cost: { total_cost_usd: 0.89 } },
    cfg,
    extras,
  );
  expect(s).toContain("$0.00"); // not the stale $0.89
  expect(s).not.toContain("$0.89");
});

test("sessionCost: a new conversation anchors the baseline => 0, then total - baseline", () => {
  const session = "sess-cost-probe-1";
  const transcript = "/tmp/kt-tr-probe-A.jsonl";
  const key = createHash("md5").update(session).digest("hex").slice(0, 8);
  const statePath = join(tmpdir(), `kt-cost-${key}.json`);
  try { writeFileSync(statePath, ""); } catch {}
  // force the "nothing stored" state with a junk file so it must re-anchor
  writeFileSync(statePath, "{}");

  // first sighting of this transcript: anchor baseline = 0.89 -> cost 0
  expect(sessionCost({ session_id: session, transcript_path: transcript, cost: { total_cost_usd: 0.89 } })).toBe(0);
  // same conversation, total grows -> count only what accrued after the anchor
  expect(
    sessionCost({ session_id: session, transcript_path: transcript, cost: { total_cost_usd: 0.95 } }),
  ).toBeCloseTo(0.06, 5);
});

test("sessionCost: /clear (transcript changed) => back to 0", () => {
  const session = "sess-cost-probe-2";
  const tA = "/tmp/kt-tr-probe-clearA.jsonl";
  const tB = "/tmp/kt-tr-probe-clearB.jsonl";
  const key = createHash("md5").update(session).digest("hex").slice(0, 8);
  writeFileSync(join(tmpdir(), `kt-cost-${key}.json`), "{}");

  sessionCost({ session_id: session, transcript_path: tA, cost: { total_cost_usd: 0.5 } }); // anchor at 0.5
  expect(
    sessionCost({ session_id: session, transcript_path: tA, cost: { total_cost_usd: 0.7 } }),
  ).toBeCloseTo(0.2, 5);
  // /clear -> new transcript, total still accumulating at 0.7 -> back to 0
  expect(sessionCost({ session_id: session, transcript_path: tB, cost: { total_cost_usd: 0.7 } })).toBe(0);
});

test("sessionCost: no cost => undefined (don't show $)", () => {
  expect(sessionCost({ session_id: "sess-no-cost", transcript_path: "/tmp/x.jsonl" })).toBeUndefined();
});

test("savedTokens present => L3 shows ♻️ ~Xk saved", () => {
  const extras: Extras = {
    dir: "/tmp/x", git: null, tools: 3, todos: null, quota: null, plan: null,
    savedTokens: 12_400,
  };
  const s = renderStatusline({ context_window: { used_percentage: 10, context_window_size: 200000 } }, cfg, extras);
  const l3 = s.split("\n")[2];
  expect(l3).toContain("♻️ ~12k saved");
});

test("savedTokens under 1000 => raw number; 0/null => hidden", () => {
  const base: Extras = { dir: "/tmp/x", git: null, tools: 3, todos: null, quota: null, plan: null };
  const sSmall = renderStatusline(
    { context_window: { used_percentage: 10, context_window_size: 200000 } },
    cfg,
    { ...base, savedTokens: 800 },
  );
  expect(sSmall).toContain("♻️ ~800 saved");
  const sZero = renderStatusline(
    { context_window: { used_percentage: 10, context_window_size: 200000 } },
    cfg,
    { ...base, savedTokens: 0 },
  );
  expect(sZero).not.toContain("saved");
  const sNull = renderStatusline(
    { context_window: { used_percentage: 10, context_window_size: 200000 } },
    cfg,
    base,
  );
  expect(sNull).not.toContain("saved");
});

test("collectSavedTokens: reads the project's index.jsonl, converts to tokens (chars/4)", () => {
  const dir = "/tmp/kt-test-saved-tokens";
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  appendMeta(
    { id: "a", command: "npm test", profile: "test", originalChars: 8_000, compactChars: 4_000 },
    { root: `${dir}/.kt/runs` },
  );
  appendMeta(
    { id: "b", command: "git diff", profile: "git", originalChars: 6_000, compactChars: 2_000 },
    { root: `${dir}/.kt/runs` },
  );
  expect(collectSavedTokens(dir)).toBe(2_000); // (4000+4000)/4
});

test("collectSavedTokens: no data yet => null (auto-hide)", () => {
  const dir = "/tmp/kt-test-saved-tokens-empty";
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  expect(collectSavedTokens(dir)).toBeNull();
});

test("collectGit returns a branch for this repo", () => {
  const g = collectGit(process.cwd());
  expect(g).not.toBeNull();
  expect(typeof g!.branch).toBe("string");
  expect(g!.branch.length).toBeGreaterThan(0);
});

test("collectGit: cached within the TTL, recomputed past it", () => {
  const dir = "/tmp/kt-git-cache-probe-nonrepo";
  const key = createHash("md5").update(dir).digest("hex").slice(0, 8);
  const cachePath = join(tmpdir(), `kt-git-${key}.json`);
  const fake = { branch: "cached-branch", ahead: 0, behind: 0, added: 9, removed: 0 };
  writeFileSync(cachePath, JSON.stringify({ ts: 1000, git: fake }));

  // now=1400 → 400ms < the 1500ms TTL → serve the cache (no git run)
  expect(collectGit(dir, 1400)?.branch).toBe("cached-branch");
  // now=5000 → past the TTL → recompute; dir isn't a repo → null
  expect(collectGit(dir, 5000)).toBeNull();
});

test("perTurn => shows the cost of each following turn on L1 (a fatter context costs more)", () => {
  const s = renderStatusline(
    { context_window: { used_percentage: 30, context_window_size: 1_000_000 }, model: { display_name: "Opus 5" } },
    cfg,
    { dir: "/tmp", git: null, tools: 0, todos: null, quota: null, plan: null, perTurn: 0.104 },
  );
  expect(s.split("\n")[0]).toContain("$0.10/turn");
});

test("perTurn null/0 => hidden entirely, never prints $0.00/turn", () => {
  const s = renderStatusline(
    { context_window: { used_percentage: 30, context_window_size: 1_000_000 } },
    cfg,
    { dir: "/tmp", git: null, tools: 0, todos: null, quota: null, plan: null, perTurn: null },
  );
  expect(s).not.toContain("/turn");
});

test("idle >= 60 minutes => warns the cache expired + the reload price", () => {
  const s = renderStatusline(
    { context_window: { used_percentage: 30, context_window_size: 1_000_000 } },
    cfg,
    { dir: "/tmp", git: null, tools: 0, todos: null, quota: null, plan: null,
      idle: { minutes: 135, cacheAlive: false, reloadCost: 5.02 } },
  );
  expect(s).toContain("2h15");
  expect(s).toContain("$5.02");
});

test("short idle => shows the time only, no price scare", () => {
  const s = renderStatusline(
    { context_window: { used_percentage: 30, context_window_size: 1_000_000 } },
    cfg,
    { dir: "/tmp", git: null, tools: 0, todos: null, quota: null, plan: null,
      idle: { minutes: 25, cacheAlive: true, reloadCost: 5.02 } },
  );
  expect(s).toContain("25m");
  expect(s).not.toContain("$5.02");
});

test("idle below the threshold => hidden entirely (don't clutter the status line)", () => {
  const s = renderStatusline(
    { context_window: { used_percentage: 30, context_window_size: 1_000_000 } },
    cfg,
    { dir: "/tmp", git: null, tools: 0, todos: null, quota: null, plan: null,
      idle: { minutes: 3, cacheAlive: true, reloadCost: 1 } },
  );
  expect(s).not.toContain("m ·");
  expect(s).not.toContain("3m");
});
