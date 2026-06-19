import { test, expect } from "bun:test";
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

test("dòng 2 từ extras: dir + branch + diff + tools", () => {
  const extras: Extras = {
    dir: `${process.env.HOME}/Dev/kuro-lean`,
    git: { branch: "main", ahead: 1, behind: 0, added: 12, removed: 3 },
    tools: 8,
  };
  const s = renderStatusline({ context_window: { used_percentage: 10, context_window_size: 200000 } }, cfg, extras);
  const l2 = s.split("\n")[1] ?? "";
  expect(l2).toContain("📁 ~/Dev/kuro-lean"); // homify
  expect(l2).toContain("🌿 main");
  expect(l2).toContain("↑1");
  expect(l2).toContain("📝 +12 -3");
  expect(l2).toContain("🔧 8 tools");
});

test("extras không có git => chỉ dòng 1 (l2 chỉ có dir nên bỏ)", () => {
  const extras: Extras = { dir: "/tmp/x", git: null, tools: 0 };
  const s = renderStatusline({ context_window: { used_percentage: 10, context_window_size: 200000 } }, cfg, extras);
  expect(s.split("\n").length).toBe(1); // l2 chỉ có dir => không thêm dòng
});

test("collectGit trên repo này trả branch", () => {
  const g = collectGit(process.cwd());
  expect(g).not.toBeNull();
  expect(typeof g!.branch).toBe("string");
  expect(g!.branch.length).toBeGreaterThan(0);
});
