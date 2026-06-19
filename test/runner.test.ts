import { test, expect } from "bun:test";
import { run } from "../src/runner";

test("capture stdout + exit 0", async () => {
  const r = await run(["echo", "hello"]);
  expect(r.stdout.trim()).toBe("hello");
  expect(r.exitCode).toBe(0);
});

test("bảo toàn exit code khác 0", async () => {
  const r = await run(["sh", "-c", "echo oops >&2; exit 3"]);
  expect(r.exitCode).toBe(3);
  expect(r.stderr).toContain("oops");
});

test("binary không tồn tại => exitCode 127, KHÔNG throw", async () => {
  const r = await run(["GIT_PAGER=cat", "git", "diff"]);
  expect(r.exitCode).toBe(127);
  expect(r.spawnError).toBeDefined();
  expect(r.stderr).toContain("kt: không chạy được");
});

test("timeout => kill, timedOut=true, giữ output đã có", async () => {
  const r = await run(["sh", "-c", "echo early; sleep 5; echo late"], 300);
  expect(r.timedOut).toBe(true);
  expect(r.stdout).toContain("early");
  expect(r.stdout).not.toContain("late");
});
