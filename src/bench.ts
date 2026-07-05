import { mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { installSettings } from "./init";

export type Arm = "baseline" | "kt";

export interface RunMetrics {
  costUsd: number;
  durationMs: number;
  numTurns: number;
  contextTokens: number; // input + cache_read + cache_creation = tổng token đi vào model
  outputTokens: number;
}

export interface ArmSummary {
  arm: Arm;
  valid: number;
  total: number;
  costUsd: number;
  contextTokens: number;
  outputTokens: number;
  numTurns: number;
  durationMs: number;
}

export interface BenchOptions {
  runs: number;
  model: string;
  keep: boolean;
  maxTurns: number;
}

export const TASK_PROMPT =
  "Run `bun test`, find the bug in src/ that makes tests fail (do NOT modify test files), fix it, then run `bun test` again to confirm all tests pass.";

export function parseClaudeJson(stdout: string): RunMetrics | null {
  let obj: any;
  try {
    obj = JSON.parse(stdout);
  } catch {
    // stdout có thể lẫn dòng khác → lấy dòng JSON parse được cuối cùng
    const lines = stdout.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try { obj = JSON.parse(lines[i]!); break; } catch {}
    }
  }
  if (!obj || obj.type !== "result" || obj.is_error) return null;
  const n = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  // modelUsage là số cộng dồn per-model → đáng tin hơn usage (có thể chỉ là lượt cuối)
  let input = 0, output = 0, cacheRead = 0, cacheCreate = 0;
  const mu = obj.modelUsage;
  if (mu && typeof mu === "object" && Object.keys(mu).length > 0) {
    for (const m of Object.values(mu) as any[]) {
      input += n(m.inputTokens);
      output += n(m.outputTokens);
      cacheRead += n(m.cacheReadInputTokens);
      cacheCreate += n(m.cacheCreationInputTokens);
    }
  } else {
    const u = obj.usage ?? {};
    input = n(u.input_tokens);
    output = n(u.output_tokens);
    cacheRead = n(u.cache_read_input_tokens);
    cacheCreate = n(u.cache_creation_input_tokens);
  }
  return {
    costUsd: n(obj.total_cost_usd),
    durationMs: n(obj.duration_ms),
    numTurns: n(obj.num_turns),
    contextTokens: input + cacheRead + cacheCreate,
    outputTokens: output,
  };
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function summarize(arm: Arm, runs: (RunMetrics | null)[], passed: boolean[]): ArmSummary {
  const ok = runs.filter((r, i): r is RunMetrics => r !== null && passed[i] === true);
  const med = (f: (r: RunMetrics) => number) => median(ok.map(f));
  return {
    arm,
    valid: ok.length,
    total: runs.length,
    costUsd: med((r) => r.costUsd),
    contextTokens: med((r) => r.contextTokens),
    outputTokens: med((r) => r.outputTokens),
    numTurns: med((r) => r.numTurns),
    durationMs: med((r) => r.durationMs),
  };
}

export function formatReport(base: ArmSummary, kt: ArmSummary): string {
  const pct = (b: number, k: number) => (b > 0 ? `${(((k - b) / b) * 100).toFixed(0)}%` : "-");
  const num = (x: number) => Math.round(x).toLocaleString("en-US");
  const usd = (x: number) => `$${x.toFixed(4)}`;
  const sec = (x: number) => `${(x / 1000).toFixed(1)}s`;
  const row = (label: string, b: number, k: number, fmt: (x: number) => string) =>
    `| ${label} | ${fmt(b)} | ${fmt(k)} | ${pct(b, k)} |`;
  return [
    "| Metric (median) | baseline | kt | Δ |",
    "|---|---|---|---|",
    row("Context tokens (in+cache)", base.contextTokens, kt.contextTokens, num),
    row("Output tokens", base.outputTokens, kt.outputTokens, num),
    row("Cost (USD)", base.costUsd, kt.costUsd, usd),
    row("Turns", base.numTurns, kt.numTurns, num),
    row("Duration", base.durationMs, kt.durationMs, sec),
    "",
    `runs hợp lệ (test xanh sau phiên): baseline ${base.valid}/${base.total}, kt ${kt.valid}/${kt.total}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Fixture: mini project Bun có bug thật (median quên sort) — 3 test fail, ~45 test pass
// làm nhiễu output đủ lớn để kt có đất nén. Sinh lúc chạy (không để file *.test.ts
// trong repo kẻo bun test của kuro-lean quét nhầm).
// ---------------------------------------------------------------------------

const FIXTURE_STATS_SRC = `export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length;
}
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = xs;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
export function formatVnd(amount: number): string {
  return Math.round(amount).toLocaleString("en-US") + " \\u20ab";
}
`;

const FIXTURE_STATS_TEST = `import { test, expect } from "bun:test";
import { sum, mean, median, clamp, formatVnd } from "../src/stats";

const SUM_CASES: [number[], number][] = [
  [[], 0], [[1], 1], [[1, 2], 3], [[1, 2, 3], 6], [[-1, 1], 0],
  [[10, 20, 30], 60], [[0.5, 0.5], 1], [[100], 100], [[2, 2, 2, 2], 8], [[-5, -5], -10],
];
for (const [xs, want] of SUM_CASES) test(\`sum \${JSON.stringify(xs)} = \${want}\`, () => expect(sum(xs)).toBe(want));

const MEAN_CASES: [number[], number][] = [
  [[], 0], [[4], 4], [[2, 4], 3], [[1, 2, 3], 2], [[10, 20], 15], [[0, 0, 0], 0],
];
for (const [xs, want] of MEAN_CASES) test(\`mean \${JSON.stringify(xs)} = \${want}\`, () => expect(mean(xs)).toBe(want));

const CLAMP_CASES: [number, number, number, number][] = [
  [5, 0, 10, 5], [-1, 0, 10, 0], [11, 0, 10, 10], [0, 0, 10, 0], [10, 0, 10, 10], [7, 7, 7, 7],
];
for (const [x, lo, hi, want] of CLAMP_CASES) test(\`clamp(\${x}, \${lo}, \${hi}) = \${want}\`, () => expect(clamp(x, lo, hi)).toBe(want));

const VND_CASES: [number, string][] = [
  [1000, "1,000 \\u20ab"], [0, "0 \\u20ab"], [999.6, "1,000 \\u20ab"], [1234567, "1,234,567 \\u20ab"], [50, "50 \\u20ab"],
];
for (const [x, want] of VND_CASES) test(\`formatVnd \${x}\`, () => expect(formatVnd(x)).toBe(want));

test("median sorted odd", () => expect(median([1, 2, 3])).toBe(2));
test("median sorted even", () => expect(median([1, 2, 3, 4])).toBe(2.5));
test("median single", () => expect(median([7])).toBe(7));
test("median empty", () => expect(median([])).toBe(0));
test("median unsorted odd", () => expect(median([9, 1, 5])).toBe(5));
test("median unsorted even", () => expect(median([7, 1, 3, 5])).toBe(4));
test("median unsorted large", () => expect(median([10, 2, 8, 4, 6])).toBe(6));
`;

const FIXTURE_TEXT_SRC = `export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "\\u2026";
}
`;

const FIXTURE_TEXT_TEST = `import { test, expect } from "bun:test";
import { slugify, truncate } from "../src/text";

const SLUG_CASES: [string, string][] = [
  ["Hello World", "hello-world"], ["  trim  ", "trim"], ["UPPER", "upper"],
  ["a b c", "a-b-c"], ["xin chao", "xin-chao"], ["100%", "100"],
  ["multi---dash", "multi-dash"], ["", ""], ["one", "one"], ["Tag: v1.2", "tag-v1-2"],
];
for (const [s, want] of SLUG_CASES) test(\`slugify \${JSON.stringify(s)}\`, () => expect(slugify(s)).toBe(want));

const TRUNC_CASES: [string, number, string][] = [
  ["hello", 10, "hello"], ["hello", 5, "hello"], ["hello world", 5, "hell\\u2026"],
  ["", 3, ""], ["abc", 3, "abc"], ["abcd", 3, "ab\\u2026"],
];
for (const [s, max, want] of TRUNC_CASES) test(\`truncate(\${JSON.stringify(s)}, \${max})\`, () => expect(truncate(s, max)).toBe(want));
`;

export function writeFixture(dir: string): void {
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "test"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "kt-bench-fixture", type: "module" }, null, 2) + "\n");
  writeFileSync(join(dir, "src", "stats.ts"), FIXTURE_STATS_SRC);
  writeFileSync(join(dir, "test", "stats.test.ts"), FIXTURE_STATS_TEST);
  writeFileSync(join(dir, "src", "text.ts"), FIXTURE_TEXT_SRC);
  writeFileSync(join(dir, "test", "text.test.ts"), FIXTURE_TEXT_TEST);
}

export function prepareWorkspace(dir: string, arm: Arm): void {
  mkdirSync(dir, { recursive: true });
  writeFixture(dir);
  if (arm === "kt") {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    installSettings(join(dir, ".claude", "settings.json"), "kt");
  }
}

export function armEnv(arm: Arm, base: Record<string, string | undefined>): Record<string, string | undefined> {
  // baseline phải trung hoà cả hook GLOBAL của máy đã `kt init` → dùng kill-switch KT_DISABLE
  return arm === "baseline" ? { ...base, KT_DISABLE: "1" } : { ...base, KT_DISABLE: undefined };
}

export function buildClaudeArgs(model: string, maxTurns: number): string[] {
  return [
    "claude", "-p", TASK_PROMPT,
    "--output-format", "json",
    "--model", model,
    "--max-turns", String(maxTurns),
    "--allowedTools", "Bash", "Edit", "Write", "Read",
  ];
}

export function parseBenchFlags(argv: string[]): BenchOptions {
  const opts: BenchOptions = { runs: 3, model: "claude-haiku-4-5-20251001", keep: false, maxTurns: 15 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--runs") opts.runs = Math.max(1, Number(argv[++i]) || opts.runs);
    else if (a === "--model") opts.model = argv[++i] ?? opts.model;
    else if (a === "--max-turns") opts.maxTurns = Math.max(1, Number(argv[++i]) || opts.maxTurns);
    else if (a === "--keep") opts.keep = true;
  }
  return opts;
}

export type SpawnFn = (
  argv: string[],
  opts: { cwd: string; env: Record<string, string | undefined> },
) => Promise<{ stdout: string; exitCode: number }>;

export const realSpawn: SpawnFn = async (argv, opts) => {
  const proc = Bun.spawn(argv, { cwd: opts.cwd, env: opts.env as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  // đọc cả stderr để tránh nghẽn pipe khi output dài
  const [stdout] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { stdout, exitCode: await proc.exited };
};

export async function runBench(
  opts: BenchOptions,
  spawn: SpawnFn = realSpawn,
  log: (s: string) => void = () => {},
): Promise<string> {
  const root = join(tmpdir(), `kt-bench-${Date.now()}`);
  const summaries: ArmSummary[] = [];
  for (const arm of ["baseline", "kt"] as const) {
    const metrics: (RunMetrics | null)[] = [];
    const passed: boolean[] = [];
    for (let i = 0; i < opts.runs; i++) {
      const ws = join(root, `${arm}-${i + 1}`);
      prepareWorkspace(ws, arm);
      log(`▶ ${arm} run ${i + 1}/${opts.runs}…`);
      const res = await spawn(buildClaudeArgs(opts.model, opts.maxTurns), { cwd: ws, env: armEnv(arm, process.env) });
      const m = res.exitCode === 0 ? parseClaudeJson(res.stdout) : null;
      metrics.push(m);
      // gate: phiên chỉ hợp lệ khi fixture xanh sau phiên (tránh so token của phiên bỏ dở)
      const gate = await spawn(["bun", "test"], { cwd: ws, env: { ...process.env } });
      passed.push(gate.exitCode === 0);
      log(`  metrics ${m ? "✓" : "✗"} · test sau phiên: ${gate.exitCode === 0 ? "xanh" : "đỏ"}`);
      if (!opts.keep) rmSync(ws, { recursive: true, force: true });
    }
    summaries.push(summarize(arm, metrics, passed));
  }
  if (!opts.keep) rmSync(root, { recursive: true, force: true });
  const report = formatReport(summaries[0]!, summaries[1]!);
  return opts.keep ? `${report}\nworkspaces giữ ở: ${root}\n` : `${report}\n`;
}
