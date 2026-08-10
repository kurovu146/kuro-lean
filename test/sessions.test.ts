import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { clipboardCommand, LIST_LIMIT, listSessions, parseHandoffArgs, renderSessions, resolveFrom } from "../src/sessions";
import { defaultConfig } from "../src/config";

const tmp = () => mkdtempSync(join(tmpdir(), "kt-sessions-"));

/** Build a fake transcript: a meta line (cwd/branch) + a usage line, then backdate the mtime. */
function fakeSession(
  root: string,
  slug: string,
  file: string,
  o: { cwd: string; branch: string; tokens: number; idleMin: number; pad?: number },
): string {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, file);
  const lines = [
    JSON.stringify({ type: "user", cwd: o.cwd, gitBranch: o.branch }),
    JSON.stringify({ message: { role: "user", content: "x".repeat(o.pad ?? 0) } }),
    JSON.stringify({ message: { model: "claude-opus-5", usage: { cache_read_input_tokens: o.tokens } } }),
  ];
  writeFileSync(p, lines.join("\n") + "\n");
  const t = new Date(Date.now() - o.idleMin * 60_000);
  utimesSync(p, t, t);
  return p;
}

test("lists sessions machine-wide: newest first, with the repo/branch/tokens of the last turn", () => {
  const root = tmp();
  fakeSession(root, "-Users-kuro-Dev-mot", "a.jsonl", {
    cwd: "/Users/kuro/Dev/mot", branch: "main", tokens: 96_000, idleMin: 10, pad: 3000,
  });
  fakeSession(root, "-Users-kuro-Dev-hai", "b.jsonl", {
    cwd: "/Users/kuro/Dev/hai", branch: "dev", tokens: 263_000, idleMin: 300, pad: 3000,
  });

  const rows = listSessions(root, { minBytes: 1000, limit: 10 });

  expect(rows.length).toBe(2);
  // cwd is read from inside the transcript, not inferred from the directory name - "kuro-lean" cannot be decoded back
  expect(rows[0]!.cwd).toBe("/Users/kuro/Dev/mot");
  expect(rows[0]!.branch).toBe("main");
  expect(rows[0]!.tokens).toBe(96_000);
  expect(Math.round(rows[0]!.idleMinutes)).toBe(10);
  expect(rows[1]!.cwd).toBe("/Users/kuro/Dev/hai");
  expect(rows[1]!.tokens).toBe(263_000);
});

/** A transcript whose last turn and whose mtime are set independently — the two disagree in real life. */
function fakeSessionAt(
  root: string,
  slug: string,
  file: string,
  cwd: string,
  lastTurnMin: number,
  mtimeMin: number,
): void {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, file);
  writeFileSync(
    p,
    [
      JSON.stringify({ type: "user", cwd, gitBranch: "main" }),
      JSON.stringify({ message: { role: "user", content: "x".repeat(3000) } }),
      JSON.stringify({ type: "assistant", timestamp: new Date(Date.now() - lastTurnMin * 60_000).toISOString(), message: { model: "claude-opus-5", usage: { cache_read_input_tokens: 90_000 } } }),
      JSON.stringify({ type: "file-history-snapshot" }),
    ].join("\n") + "\n",
  );
  const t = new Date(Date.now() - mtimeMin * 60_000);
  utimesSync(p, t, t);
}

test("a fresh mtime doesn't fake recency: rows are ordered by when the conversation last moved", () => {
  // Bookkeeping (file-history-snapshot, ai-title…) keeps touching an abandoned transcript, so its
  // mtime can be newer than a session genuinely worked on an hour ago. The table must not be fooled.
  const root = tmp();
  fakeSessionAt(root, "-Users-kuro-Dev-abandoned", "a.jsonl", "/Users/kuro/Dev/abandoned", 300, 5); // idle 5h, mtime 5m
  fakeSessionAt(root, "-Users-kuro-Dev-recent", "b.jsonl", "/Users/kuro/Dev/recent", 60, 60); // idle 1h, mtime 1h

  const rows = listSessions(root, { minBytes: 1000, limit: 10 });

  expect(rows[0]!.cwd).toBe("/Users/kuro/Dev/recent"); // 1h beats 5h, despite the older mtime
  expect(Math.round(rows[0]!.idleMinutes)).toBe(60);
  expect(Math.round(rows[1]!.idleMinutes)).toBe(300); // NOT the 5 minutes its mtime claims
});

test("subagents spawned into a team are not sessions to rescue", () => {
  // One orchestrator run writes a transcript per teammate into the SAME project directory, each of
  // them big and recently touched. Measured 2026-08-08: 36 of the 41 mukbang-story-gen transcripts
  // were teammates, and they filled the table while the parent sat below the fold. A teammate is not
  // rescuable anyway — its brief came from the parent, so resuming one restarts half an errand.
  const root = tmp();
  const write = (slug: string, file: string, cwd: string, extra: Record<string, unknown>) => {
    const dir = join(root, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, file),
      [
        JSON.stringify({ type: "user", cwd, gitBranch: "main", ...extra }),
        JSON.stringify({ message: { role: "user", content: "x".repeat(3000) } }),
        JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), message: { model: "claude-opus-5", usage: { cache_read_input_tokens: 90_000 } } }),
      ].join("\n") + "\n",
    );
  };
  write("-Users-kuro-Dev-mot", "impl-task3.jsonl", "/Users/kuro/Dev/mot", { agentName: "impl-task3", teamName: "session-6cccb2d9" });
  write("-Users-kuro-Dev-mot", "rev-task9.jsonl", "/Users/kuro/Dev/mot", { agentName: "rev-task9", teamName: "session-6cccb2d9" });
  write("-Users-kuro-Dev-mot", "parent.jsonl", "/Users/kuro/Dev/mot", {});

  const rows = listSessions(root, { minBytes: 1000, limit: 10 });

  // the orchestrator that spawned them IS worth rescuing, and it carries no teamName
  expect(rows.length).toBe(1);
  expect(rows[0]!.path).toContain("parent.jsonl");
});

test("a session titled after its work is not mistaken for a subagent", () => {
  // Claude Code also parks an auto-generated TITLE in agentName. Filtering on agentName alone would
  // have hidden two real sessions (e.g. "Tiếp tục dạy anh học lập trình"); only teamName means teammate.
  const root = tmp();
  const dir = join(root, "-Users-kuro-Dev-mot");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "titled.jsonl"),
    [
      JSON.stringify({ type: "user", cwd: "/Users/kuro/Dev/mot", gitBranch: "main", agentName: "Nghiên cứu Polytail" }),
      JSON.stringify({ message: { role: "user", content: "x".repeat(3000) } }),
    ].join("\n") + "\n",
  );

  expect(listSessions(root, { minBytes: 1000, limit: 10 }).length).toBe(1);
});

test("row numbers do not shift with the limit: a short table is a prefix of a longer one", () => {
  // `--list` builds the table with the row count you asked for, `--recover --from <#>` rebuilds it
  // with its own. If the ranking depended on how many rows were requested, the number you read off
  // the table would rescue a DIFFERENT session — measured 2026-08-08: row 7 was ~/Dev/vnarena/fe on
  // screen and ~/Dev/mukbang-story-gen in the rescue.
  const root = tmp();
  fakeSessionAt(root, "-a", "a.jsonl", "/Dev/a", 10, 1);
  fakeSessionAt(root, "-b", "b.jsonl", "/Dev/b", 20, 2);
  fakeSessionAt(root, "-c", "c.jsonl", "/Dev/c", 500, 3); // abandoned, but bookkeeping keeps its mtime freshest
  fakeSessionAt(root, "-d", "d.jsonl", "/Dev/d", 30, 4);
  fakeSessionAt(root, "-e", "e.jsonl", "/Dev/e", 40, 5);

  const short = listSessions(root, { minBytes: 1000, limit: 3 });
  const long = listSessions(root, { minBytes: 1000, limit: 5 });

  expect(short.map((r) => r.cwd)).toEqual(long.slice(0, 3).map((r) => r.cwd));
  // and the top 3 are the 3 genuinely least idle, not whichever 3 were touched last
  expect(short.map((r) => r.cwd)).toEqual(["/Dev/a", "/Dev/b", "/Dev/d"]);
});

test("skips sessions that are too short: nothing to rescue means nothing in the list", () => {
  const root = tmp();
  fakeSession(root, "-Users-kuro-Dev-mot", "co-viec.jsonl", {
    cwd: "/Users/kuro/Dev/mot", branch: "main", tokens: 96_000, idleMin: 60, pad: 3000,
  });
  // a session just opened with one line typed - newest, but empty
  fakeSession(root, "-Users-kuro-Dev-mot", "vua-mo.jsonl", {
    cwd: "/Users/kuro/Dev/mot", branch: "main", tokens: 900, idleMin: 0,
  });

  const rows = listSessions(root, { minBytes: 1000, limit: 10 });

  expect(rows.length).toBe(1);
  expect(rows[0]!.path).toContain("co-viec.jsonl");
});

// ---- the table to choose from ----

// the home to shorten against is injected, never homedir() - on CI that is /home/runner and these fixtures would print absolute
const HOME = "/Users/kuro";
const rows = [
  { path: "/p/a.jsonl", cwd: "/Users/kuro/Dev/fb-auto-post", branch: "main", idleMinutes: 2, tokens: 263_000, model: "claude-opus-5", bytes: 2e6 },
  { path: "/p/b.jsonl", cwd: "/Users/kuro/Dev/kuro-lean", branch: "dev", idleMinutes: 312, tokens: 178_000, model: "claude-opus-5", bytes: 9e5 },
];

test("session table: numbered, repo names with dashes preserved, with the reload price", () => {
  const out = renderSessions(rows, defaultConfig.pricing, HOME);

  expect(out).toContain("1");
  expect(out).toContain("~/Dev/fb-auto-post (main)"); // must NOT become fb/auto/post
  expect(out).toContain("263k tok");
  expect(out).toContain("$2.63"); // 263k × $5/1M × 2 (cache write)
  expect(out).toContain("5h12"); // 312 minutes
});

test("--from accepts a row number from the table", () => {
  expect(resolveFrom(rows, "2")).toBe("/p/b.jsonl");
});

test("--from accepts a path outright, no table lookup needed", () => {
  expect(resolveFrom(rows, "/noi/khac/c.jsonl")).toBe("/noi/khac/c.jsonl");
});

test("--from pointing outside the table => null, never guess at a session", () => {
  expect(resolveFrom(rows, "9")).toBeNull();
});

// ---- command-line flags ----

test("kt handoff with no flags => still the session-closing prompt as before", () => {
  expect(parseHandoffArgs([])).toEqual({ mode: "prompt", file: ".kt/handoff.md", copy: false });
  expect(parseHandoffArgs(["ghi-chu.md"])).toEqual({ mode: "prompt", file: "ghi-chu.md", copy: false });
});

test("kt handoff --list [N] => lists them, N is the row count", () => {
  expect(parseHandoffArgs(["--list"])).toEqual({ mode: "list", limit: LIST_LIMIT });
  expect(parseHandoffArgs(["--list", "5"])).toEqual({ mode: "list", limit: 5 });
});

test("the printed table and the --from lookup use ONE limit, so a row number can't mean two things", () => {
  // They were 10 and 20 once. Row 7 on screen was ~/Dev/vnarena/fe; `--from 7` rescued
  // ~/Dev/mukbang-story-gen. Anything that re-introduces a second number brings that back.
  expect((parseHandoffArgs(["--list"]) as { limit: number }).limit).toBe(LIST_LIMIT);
});

test("kt handoff --recover [N] --from X => keeps the old N, adds a way to point at a session", () => {
  expect(parseHandoffArgs(["--recover"])).toEqual({ mode: "recover", n: 60, from: null, copy: false });
  expect(parseHandoffArgs(["--recover", "30"])).toEqual({ mode: "recover", n: 30, from: null, copy: false });
  expect(parseHandoffArgs(["--recover", "--from", "2"])).toEqual({ mode: "recover", n: 60, from: "2", copy: false });
  expect(parseHandoffArgs(["--recover", "30", "--from", "/p/x.jsonl"])).toEqual({
    mode: "recover", n: 30, from: "/p/x.jsonl", copy: false,
  });
});

test("usage unreadable => shows '?', never 0k which would look like an empty session", () => {
  const out = renderSessions(
    [{ path: "/p/c.jsonl", cwd: "/Users/kuro/Dev/mot", branch: "main", idleMinutes: 133, tokens: 0, model: "", bytes: 5e5 }],
    defaultConfig.pricing,
  );
  expect(out).toContain("? tok");
  expect(out).not.toContain("0k tok");
});

// ---- --copy: straight to the clipboard, no hunting for a file ----

test("--copy is accepted in every form, and is never read as a filename", () => {
  expect(parseHandoffArgs(["--copy"])).toEqual({ mode: "prompt", file: ".kt/handoff.md", copy: true });
  expect(parseHandoffArgs(["--recover", "--from", "3", "--copy"])).toEqual({
    mode: "recover", n: 60, from: "3", copy: true,
  });
});

test("clipboard: one command per platform, never guessing at one that does not exist", () => {
  expect(clipboardCommand("darwin")).toEqual({ cmd: "pbcopy", args: [] });
  expect(clipboardCommand("win32")).toEqual({ cmd: "clip", args: [] });
  expect(clipboardCommand("linux")).toEqual({ cmd: "xclip", args: ["-selection", "clipboard"] });
  expect(clipboardCommand("freebsd")).toBeNull();
});
