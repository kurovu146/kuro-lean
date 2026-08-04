import { test, expect } from "bun:test";
import { decideCompress } from "../src/hooks/compress";

test("lệnh test => rewrite sang kt run", () => {
  // isolation: if the env inherits KT_DISABLE=1 (e.g. running it with that variable set)
  // the kill switch returns null -> this test would fail spuriously. Unset it to check default behaviour.
  const saved = process.env.KT_DISABLE;
  delete process.env.KT_DISABLE;
  try {
    expect(decideCompress("npm test")).toBe("kt run -- npm test");
  } finally {
    if (saved !== undefined) process.env.KT_DISABLE = saved;
  }
});

test("already kt => skip", () => {
  expect(decideCompress("kt run -- npm test")).toBeNull();
});

test("has a pipe/redirect => skip (do not break the logic)", () => {
  expect(decideCompress("npm test | tee out.txt")).toBeNull();
  expect(decideCompress("npm test > out.txt")).toBeNull();
});

test("generic commands (grep/sed/ls) => still rewritten - the biggest context eater", () => {
  expect(decideCompress("grep -rn foo src")).toBe("kt run -- grep -rn foo src");
  expect(decideCompress("ls -la")).toBe("kt run -- ls -la");
});

test("cd X && cmd => the cd stays OUTSIDE (Claude Code keeps cwd between commands), only the rest is wrapped", () => {
  expect(decideCompress("cd /tmp/x && go test ./...")).toBe("cd /tmp/x && kt run -- go test ./...");
  expect(decideCompress("cd /tmp/x && echo a && ls")).toBe(
    "cd /tmp/x && kt run -- bash -c 'echo a && ls'",
  );
});

test("an && chain without cd => wrap the whole chain through bash -c", () => {
  expect(decideCompress('echo "=== A ===" && ls -la')).toBe(
    `kt run -- bash -c 'echo "=== A ===" && ls -la'`,
  );
});

test("a state-changing command mid-chain => null (wrapping would lose its effect)", () => {
  expect(decideCompress("echo a && cd /tmp/x")).toBeNull();
  expect(decideCompress("nvm use 20 && npm test")).toBeNull();
  expect(decideCompress("export FOO=1 && npm test")).toBeNull();
});

test("dev server / tail -f => null (wrapping would hang until the timeout)", () => {
  expect(decideCompress("npm run dev")).toBeNull();
  expect(decideCompress("cd /tmp/x && next dev")).toBeNull();
  expect(decideCompress("tail -f app.log")).toBeNull();
});

test("an && chain containing watch => null (wrapping would hang)", () => {
  expect(decideCompress("cd /tmp/x && npm run dev -w")).toBeNull();
});

test("an && chain containing a pipe/redirect => null (keeps the existing guard)", () => {
  expect(decideCompress("cd /tmp/x && npm test | head")).toBeNull();
  expect(decideCompress("cd /tmp/x && npm test > out.txt")).toBeNull();
});

test("a command needing a tty/interactivity => null (kt run drops stdin, wrapping breaks it)", () => {
  expect(decideCompress("sudo launchctl list")).toBeNull();
  expect(decideCompress("ssh box uptime")).toBeNull();
  expect(decideCompress("gh auth login")).toBeNull();
  expect(decideCompress("docker exec -it web sh")).toBeNull();
  expect(decideCompress("git rebase -i HEAD~3")).toBeNull();
  expect(decideCompress("cd /tmp/x && sudo make install")).toBeNull();
});

test("a bare REPL => null, but the same command with an argument is rewritten", () => {
  expect(decideCompress("node")).toBeNull();
  expect(decideCompress("python3")).toBeNull();
  expect(decideCompress("python3 scripts/report.py")).toBe("kt run -- python3 scripts/report.py");
});

test("KT_DISABLE=1 => null (kill-switch)", () => {
  process.env.KT_DISABLE = "1";
  try {
    expect(decideCompress("npm test")).toBeNull();
  } finally {
    delete process.env.KT_DISABLE;
  }
});

test("an env prefix => wrap through bash -c (a spawn array cannot express FOO=1)", () => {
  expect(decideCompress("GIT_PAGER=cat git diff")).toBe("kt run -- bash -c 'GIT_PAGER=cat git diff'");
  expect(decideCompress("CI=1 npm test")).toBe("kt run -- bash -c 'CI=1 npm test'");
});

test("2>&1 (a common agent idiom) => wrap through bash -c", () => {
  expect(decideCompress("npm test 2>&1")).toBe("kt run -- bash -c 'npm test 2>&1'");
});

test("2>&1 but still another pipe/redirect => null", () => {
  expect(decideCompress("npm test 2>&1 | tee log")).toBeNull();
  expect(decideCompress("npm test 2>&1 > out.txt")).toBeNull();
});

test("bash -c escapes single quotes inside the command", () => {
  expect(decideCompress("CI=1 bun test --filter 'auth'")).toBe(
    "kt run -- bash -c 'CI=1 bun test --filter '\\''auth'\\'''",
  );
});

test("an env prefix + watch => still null (wrapping would hang)", () => {
  expect(decideCompress("CI=1 tsc --watch")).toBeNull();
});

test("env-prefix + lệnh generic => vẫn wrap qua bash -c", () => {
  expect(decideCompress("FOO=1 echo hi")).toBe("kt run -- bash -c 'FOO=1 echo hi'");
});

test("lệnh lint => rewrite sang kt run", () => {
  expect(decideCompress("eslint src")).toBe("kt run -- eslint src");
});

test("`kt run` already somewhere inside (a manual bypass) => null, avoids double-wrapping", () => {
  expect(decideCompress("KT_RAW=1 kt run -- git diff")).toBeNull();
});

test("a watch/long-running command => null (wrapping would hang)", () => {
  expect(decideCompress("tsc --watch")).toBeNull();
  expect(decideCompress("jest --watch")).toBeNull();
  expect(decideCompress("vitest watch")).toBeNull();
  expect(decideCompress("next build -w")).toBeNull();
});

test("yarn dev => null (no longer mistaken for install)", () => {
  expect(decideCompress("yarn dev")).toBeNull();
  expect(decideCompress("yarn start")).toBeNull();
});

test("newline trong lệnh => null", () => {
  expect(decideCompress("npm test\necho hi")).toBeNull();
});
