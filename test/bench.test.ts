import { test, expect } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import {
  parseClaudeJson, median, summarize, formatReport, writeFixture,
  prepareWorkspace, armEnv, buildClaudeArgs, parseBenchFlags,
  type RunMetrics,
} from "../src/bench";

const DIR = "/tmp/kt-test-bench";

function freshDir(): string {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  return DIR;
}

// ---------- parseClaudeJson ----------

test("parseClaudeJson: cộng dồn modelUsage nhiều model", () => {
  const out = JSON.stringify({
    type: "result", is_error: false, total_cost_usd: 0.0123, duration_ms: 45000, num_turns: 7,
    usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 },
    modelUsage: {
      "claude-haiku-4-5-20251001": { inputTokens: 100, outputTokens: 200, cacheReadInputTokens: 1000, cacheCreationInputTokens: 50 },
      "claude-sonnet-5": { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 100, cacheCreationInputTokens: 5 },
    },
  });
  const m = parseClaudeJson(out)!;
  expect(m.costUsd).toBeCloseTo(0.0123);
  expect(m.numTurns).toBe(7);
  expect(m.contextTokens).toBe(110 + 1100 + 55); // input + cacheRead + cacheCreate (modelUsage, KHÔNG phải usage)
  expect(m.outputTokens).toBe(220);
});

test("parseClaudeJson: fallback sang usage khi không có modelUsage", () => {
  const out = JSON.stringify({
    type: "result", is_error: false, total_cost_usd: 0.5, duration_ms: 1000, num_turns: 2,
    usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
  });
  const m = parseClaudeJson(out)!;
  expect(m.contextTokens).toBe(80);
  expect(m.outputTokens).toBe(20);
});

test("parseClaudeJson: lấy dòng JSON cuối khi stdout lẫn dòng khác", () => {
  const json = JSON.stringify({ type: "result", is_error: false, total_cost_usd: 0.1, duration_ms: 1, num_turns: 1, usage: { input_tokens: 5, output_tokens: 6, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  const m = parseClaudeJson(`noise trước\n${json}`);
  expect(m?.outputTokens).toBe(6);
});

test("parseClaudeJson: rác hoặc is_error => null", () => {
  expect(parseClaudeJson("not json at all")).toBeNull();
  expect(parseClaudeJson(JSON.stringify({ type: "result", is_error: true }))).toBeNull();
  expect(parseClaudeJson(JSON.stringify({ type: "system" }))).toBeNull();
});

// ---------- median / summarize ----------

test("median: lẻ, chẵn, rỗng", () => {
  expect(median([9, 1, 5])).toBe(5);
  expect(median([4, 1, 3, 2])).toBe(2.5);
  expect(median([])).toBe(0);
});

test("summarize: chỉ tính run có metrics VÀ qua gate test", () => {
  const m = (cost: number): RunMetrics => ({ costUsd: cost, durationMs: 1000, numTurns: 5, contextTokens: 100, outputTokens: 10 });
  const s = summarize("kt", [m(1), m(9), null, m(100)], [true, true, true, false]);
  expect(s.valid).toBe(2);
  expect(s.total).toBe(4);
  expect(s.costUsd).toBe(5); // median của [1, 9]
});

// ---------- formatReport ----------

test("formatReport: bảng markdown + Δ âm khi kt rẻ hơn + số run hợp lệ", () => {
  const base = { arm: "baseline" as const, valid: 3, total: 3, costUsd: 0.10, contextTokens: 200000, outputTokens: 5000, numTurns: 10, durationMs: 60000 };
  const kt = { arm: "kt" as const, valid: 3, total: 3, costUsd: 0.05, contextTokens: 100000, outputTokens: 5000, numTurns: 10, durationMs: 50000 };
  const r = formatReport(base, kt);
  expect(r).toContain("| Metric (median) | baseline | kt | Δ |");
  expect(r).toContain("-50%");
  expect(r).toContain("baseline 3/3, kt 3/3");
});

// ---------- fixture ----------

test("writeFixture: bun test đỏ trước khi fix, xanh sau khi fix median", () => {
  const dir = freshDir();
  writeFixture(dir);
  const before = Bun.spawnSync(["bun", "test"], { cwd: dir });
  expect(before.exitCode).not.toBe(0); // bug median → có test fail
  // fix đúng: sort bản copy trước khi lấy giữa
  const statsPath = `${dir}/src/stats.ts`;
  const fixed = readFileSync(statsPath, "utf8").replace(
    "const s = xs;",
    "const s = [...xs].sort((a, b) => a - b);",
  );
  writeFileSync(statsPath, fixed);
  const after = Bun.spawnSync(["bun", "test"], { cwd: dir });
  expect(after.exitCode).toBe(0);
});

// ---------- workspace / env / args / flags ----------

test("prepareWorkspace: arm kt có .claude/settings.json với hook, baseline thì không", () => {
  const dir = freshDir();
  prepareWorkspace(`${dir}/kt`, "kt");
  const cfg = JSON.parse(readFileSync(`${dir}/kt/.claude/settings.json`, "utf8"));
  const cmds = cfg.hooks.PreToolUse.flatMap((m: any) => m.hooks.map((h: any) => h.command));
  expect(cmds).toContain("kt hook-compress");
  prepareWorkspace(`${dir}/base`, "baseline");
  expect(existsSync(`${dir}/base/.claude`)).toBe(false);
  expect(existsSync(`${dir}/base/package.json`)).toBe(true);
});

test("armEnv: baseline bật KT_DISABLE, kt tắt", () => {
  expect(armEnv("baseline", {}).KT_DISABLE).toBe("1");
  expect(armEnv("kt", { KT_DISABLE: "1" }).KT_DISABLE).toBeUndefined();
});

test("buildClaudeArgs: headless json, model + max-turns truyền vào", () => {
  const args = buildClaudeArgs("claude-haiku-4-5-20251001", 15);
  expect(args[0]).toBe("claude");
  expect(args).toContain("--output-format");
  expect(args).toContain("json");
  expect(args).toContain("claude-haiku-4-5-20251001");
  expect(args).toContain("15");
  expect(args).toContain("Bash");
});

test("parseBenchFlags: defaults + override", () => {
  const d = parseBenchFlags([]);
  expect(d.runs).toBe(3);
  expect(d.keep).toBe(false);
  expect(d.maxTurns).toBe(15);
  expect(d.model).toContain("haiku");
  const o = parseBenchFlags(["--runs", "5", "--model", "sonnet", "--keep", "--max-turns", "20"]);
  expect(o).toEqual({ runs: 5, model: "sonnet", keep: true, maxTurns: 20 });
});

// ---------- runBench (fake spawn — không tốn quota) ----------

import { runBench, type SpawnFn } from "../src/bench";

test("runBench: 2 arm × N runs, env đúng theo arm, report từ metrics fake", async () => {
  const calls: { argv: string[]; cwd: string; env: Record<string, string | undefined> }[] = [];
  const fakeResult = (cost: number) => JSON.stringify({
    type: "result", is_error: false, total_cost_usd: cost, duration_ms: 30000, num_turns: 6,
    usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 50000, cache_creation_input_tokens: 2000 },
  });
  const fake: SpawnFn = async (argv, opts) => {
    calls.push({ argv, cwd: opts.cwd, env: opts.env });
    if (argv[0] === "claude") {
      // baseline đắt hơn kt để Δ âm
      return { stdout: fakeResult(opts.env.KT_DISABLE === "1" ? 0.2 : 0.1), exitCode: 0 };
    }
    return { stdout: "", exitCode: 0 }; // gate `bun test` xanh
  };
  const report = await runBench({ runs: 2, model: "claude-haiku-4-5-20251001", keep: false, maxTurns: 15 }, fake);
  const claudeCalls = calls.filter((c) => c.argv[0] === "claude");
  expect(claudeCalls.length).toBe(4); // 2 arm × 2 runs
  expect(claudeCalls.filter((c) => c.env.KT_DISABLE === "1").length).toBe(2); // baseline
  const gateCalls = calls.filter((c) => c.argv[0] === "bun");
  expect(gateCalls.length).toBe(4); // mỗi run 1 lần gate
  expect(report).toContain("baseline 2/2, kt 2/2");
  expect(report).toContain("-50%"); // cost 0.2 → 0.1
});

test("runBench: claude lỗi hoặc gate đỏ => run không hợp lệ", async () => {
  const fake: SpawnFn = async (argv) => {
    if (argv[0] === "claude") return { stdout: "boom", exitCode: 1 };
    return { stdout: "", exitCode: 1 };
  };
  const report = await runBench({ runs: 1, model: "m", keep: false, maxTurns: 15 }, fake);
  expect(report).toContain("baseline 0/1, kt 0/1");
});
