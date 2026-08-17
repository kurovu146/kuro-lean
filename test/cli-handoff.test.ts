import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

/**
 * A HOME holding n rescuable sessions, the k-th idle k minutes — so row k of the table is always
 * /Dev/pk, whatever row count the table happened to be built with.
 */
function homeWithSessions(n: number): string {
  const home = mkdtempSync(join(tmpdir(), "kt-clih-"));
  for (let k = 1; k <= n; k++) {
    const dir = join(home, ".claude", "projects", `-Dev-p${k}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `s${k}.jsonl`),
      [
        JSON.stringify({ type: "user", cwd: `/Dev/p${k}`, gitBranch: "main" }),
        JSON.stringify({ type: "user", message: { role: "user", content: "x".repeat(25_000) } }),
        JSON.stringify({
          type: "assistant",
          timestamp: new Date(Date.now() - k * 60_000).toISOString(),
          message: { model: "claude-opus-5", usage: { cache_read_input_tokens: 90_000 } },
        }),
      ].join("\n") + "\n",
    );
  }
  return home;
}

async function handoff(home: string, ...args: string[]) {
  const p = Bun.spawn(["bun", CLI, "handoff", ...args], {
    env: { ...process.env, HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { out: await new Response(p.stdout).text(), err: await new Response(p.stderr).text(), code: await p.exited };
}

test("--from reaches any row the table can print, not just the first LIST_LIMIT", async () => {
  // `--list 25` prints row 23, but the rescue rebuilt the table at the default 20 and called the
  // number it had just told the human to use "could not understand --from 23".
  const home = homeWithSessions(25);

  const listed = await handoff(home, "--list", "25");
  expect(listed.out).toContain("/Dev/p23");

  const got = await handoff(home, "--recover", "--from", "23");

  expect(got.code).toBe(0);
  expect(got.out).toContain("s23.jsonl"); // the row the table showed, not a neighbour
});

test("a row number past the end of the table says so, instead of blaming the number", async () => {
  const home = homeWithSessions(3);

  const past = await handoff(home, "--recover", "--from", "31");
  expect(past.code).toBe(1);
  expect(past.err).toContain("only 3 sessions");

  // a `--from` that is neither a row number nor a path is still exactly that: not understood
  const garbage = await handoff(home, "--recover", "--from", "hom-qua");
  expect(garbage.code).toBe(1);
  expect(garbage.err).toContain("could not understand");
});
