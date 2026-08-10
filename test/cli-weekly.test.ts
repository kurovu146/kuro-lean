import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

test("kt weekly prints the cached line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kt-cliw-"));
  writeFileSync(join(dir, "kt-weekly.json"), JSON.stringify({ writtenAtMs: Date.now(), line: "💵 wk $2.0k 9.0M" }));

  const p = Bun.spawn(["bun", CLI, "weekly"], { env: { ...process.env, KT_TMPDIR: dir }, stdout: "pipe" });
  const out = await new Response(p.stdout).text();

  expect(out.trim()).toBe("💵 wk $2.0k 9.0M");
});

test("kt weekly --refresh rescans and writes the cache", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kt-cliwr-"));
  const root = mkdtempSync(join(tmpdir(), "kt-cliwroot-"));
  mkdirSync(join(root, "-proj"));
  writeFileSync(
    join(root, "-proj", "s.jsonl"),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      message: { model: "claude-opus-5", usage: { input_tokens: 0, output_tokens: 200_000_000 } },
    }),
  );

  const p = Bun.spawn(["bun", CLI, "weekly", "--refresh"], {
    env: { ...process.env, KT_TMPDIR: dir, KT_PROJECTS_ROOT: root },
    stdout: "pipe",
  });
  await p.exited;

  const written = JSON.parse(readFileSync(join(dir, "kt-weekly.json"), "utf8"));
  expect(written.line).toBe("💵 wk $5.0k 200.0M");
});
