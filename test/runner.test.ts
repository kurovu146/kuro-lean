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
