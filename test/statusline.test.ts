import { test, expect } from "bun:test";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import { renderStatusline, collectGit, type Extras } from "../src/statusline";

const cfg = { warnPct: 60, dangerPct: 85 };

test("dưới warn => xanh + token + cost", () => {
  const s = renderStatusline(
    { context_window: { used_percentage: 42, total_input_tokens: 80000, total_output_tokens: 4000, context_window_size: 200000 }, model: { display_name: "Opus" }, cost: { total_cost_usd: 0.31 } },
    cfg,
  );
  expect(s).toContain("🟢");
  expect(s).toContain("42%");
  expect(s).toContain("84k");
  expect(s).toContain("$0.31");
});

test("≥ danger => đỏ", () => {
  const s = renderStatusline({ context_window: { used_percentage: 90, context_window_size: 200000 } }, cfg);
  expect(s).toContain("🔴");
});

test("thiếu field => không crash", () => {
  const s = renderStatusline({}, cfg);
  expect(typeof s).toBe("string");
});

test("ctx% kiểu /context (current_usage + buffer) + label 1M", () => {
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
  expect(s).toContain("▰"); // có bar
});

test("label 200K khi size = 200000", () => {
  const s = renderStatusline({ context_window: { used_percentage: 10, context_window_size: 200000 } }, cfg);
  expect(s).toContain("(200K)");
});

test("3 dòng đầy đủ: quota(L1) · dir/branch/plan(L2) · diff/todo/tools(L3)", () => {
  const extras: Extras = {
    dir: `${process.env.HOME}/Dev/kuro-lean`,
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
  );
  const [l1, l2, l3] = s.split("\n");
  // L1: quota nằm trước cost
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

test("extras tối thiểu (chỉ dir) => L1 + L2(dir), không có L3", () => {
  const extras: Extras = { dir: "/tmp/x", git: null, tools: 0, todos: null, quota: null, plan: null };
  const s = renderStatusline({ context_window: { used_percentage: 10, context_window_size: 200000 } }, cfg, extras);
  const lines = s.split("\n");
  expect(lines.length).toBe(2); // L1 + L2(dir); không có L3 vì không có diff/todo/tools
  expect(lines[1]).toContain("📁 /tmp/x");
});

test("collectGit trên repo này trả branch", () => {
  const g = collectGit(process.cwd());
  expect(g).not.toBeNull();
  expect(typeof g!.branch).toBe("string");
  expect(g!.branch.length).toBeGreaterThan(0);
});

test("collectGit: cache trong TTL, recompute ngoài TTL", () => {
  const dir = "/tmp/kt-git-cache-probe-nonrepo";
  const key = createHash("md5").update(dir).digest("hex").slice(0, 8);
  const cachePath = join(tmpdir(), `kt-git-${key}.json`);
  const fake = { branch: "cached-branch", ahead: 0, behind: 0, added: 9, removed: 0 };
  writeFileSync(cachePath, JSON.stringify({ ts: 1000, git: fake }));

  // now=1400 → 400ms < 1500ms TTL → trả cache (không chạy git)
  expect(collectGit(dir, 1400)?.branch).toBe("cached-branch");
  // now=5000 → ngoài TTL → recompute; dir không phải repo → null
  expect(collectGit(dir, 5000)).toBeNull();
});
