import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const DAY_MS = 24 * 60 * 60 * 1000;

test("kt weekly prints the cached line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kt-cliw-"));
  writeFileSync(join(dir, "kt-weekly.json"), JSON.stringify({ writtenAtMs: Date.now(), line: "💵 wk $2.0k 9.0M" }));

  const p = Bun.spawn(["bun", CLI, "weekly"], { env: { ...process.env, KT_TMPDIR: dir }, stdout: "pipe" });
  const out = await new Response(p.stdout).text();

  expect(out.trim()).toBe("💵 wk $2.0k 9.0M");
});

/**
 * The refresh end to end, with HOME pointed at a fixture: the real `~/.claude.json` decides the
 * window and the real `~/.claude/kt.json` decides the prices, so a test that inherits them asserts
 * against whichever machine runs it (CI's home is /home/runner, and it has neither).
 */
test("kt weekly --refresh rescans and writes the cache", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kt-cliwr-"));
  const home = mkdtempSync(join(tmpdir(), "kt-cliwhome-"));
  const root = mkdtempSync(join(tmpdir(), "kt-cliwroot-"));
  mkdirSync(join(root, "-proj"));
  // The window is anchored to a reset three days out, not to "whenever this test happened to run".
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({
      cachedUsageUtilization: { utilization: { seven_day: { resets_at: new Date(Date.now() + 3 * DAY_MS).toISOString() } } },
    }),
  );
  writeFileSync(
    join(root, "-proj", "s.jsonl"),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      message: { model: "claude-opus-5", usage: { input_tokens: 0, output_tokens: 200_000_000 } },
    }),
  );

  const p = Bun.spawn(["bun", CLI, "weekly", "--refresh"], {
    env: { ...process.env, HOME: home, KT_TMPDIR: dir, KT_PROJECTS_ROOT: root },
    stdout: "pipe",
  });
  await p.exited;

  const written = JSON.parse(readFileSync(join(dir, "kt-weekly.json"), "utf8"));
  expect(written.line).toBe("💵 wk $5.0k 200.0M");
});

/**
 * One cache file per MACHINE, so the project layer must not reach its prices. Before this, the same
 * transcripts in the same week rendered "$?" from one repo and "$0.0" from another, flipping every
 * time the 10-minute TTL expired somewhere else.
 */
test("a project-local pricing override does not move the weekly line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kt-cliwp-"));
  const home = mkdtempSync(join(tmpdir(), "kt-cliwphome-"));
  const root = mkdtempSync(join(tmpdir(), "kt-cliwproot-"));
  const project = mkdtempSync(join(tmpdir(), "kt-cliwproj-"));
  mkdirSync(join(root, "-proj"));
  writeFileSync(
    join(root, "-proj", "s.jsonl"),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      message: { model: "claude-opus-5", usage: { input_tokens: 0, output_tokens: 200_000_000 } },
    }),
  );
  // Priced from HERE, the week would read "$199.8k". The command runs in this directory.
  writeFileSync(join(project, "kt.json"), JSON.stringify({ pricing: { "claude-opus-5": { input: 999, output: 999 } } }));

  const p = Bun.spawn(["bun", CLI, "weekly", "--refresh"], {
    cwd: project,
    env: { ...process.env, HOME: home, KT_TMPDIR: dir, KT_PROJECTS_ROOT: root },
    stdout: "pipe",
  });
  await p.exited;

  // $25/1M output from the defaults (this fixture home has no ~/.claude/kt.json), not $999.
  expect(JSON.parse(readFileSync(join(dir, "kt-weekly.json"), "utf8")).line).toBe("💵 wk $5.0k 200.0M");
});
