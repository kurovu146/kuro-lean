import { test, expect } from "bun:test";
import { runAndCompress } from "../src/pipeline";
import { defaultConfig } from "../src/config";
import { showRun } from "../src/store";
import { rmSync } from "fs";

// Dùng store tmp riêng — KHÔNG đụng .kt/runs thật của repo.
const ROOT = "/tmp/kt-test-pipeline";

test("chạy lệnh => nén + lưu full + giữ exit code", async () => {
  rmSync(ROOT, { recursive: true, force: true });
  const r = await runAndCompress(["sh", "-c", "exit 0"], defaultConfig, () => "pipe001", ROOT);
  expect(r.exitCode).toBe(0);
  expect(showRun("pipe001", ROOT)).not.toBeNull();
});

test("exit code khác 0 được truyền ra", async () => {
  const r = await runAndCompress(["sh", "-c", "exit 7"], defaultConfig, () => "pipe002", ROOT);
  expect(r.exitCode).toBe(7);
});

test("run.timeoutMs từ config được áp: lệnh chậm bị kill + báo timeout", async () => {
  const cfg = { ...defaultConfig, run: { timeoutMs: 150 } };
  const start = performance.now();
  const r = await runAndCompress(["sleep", "5"], cfg, () => "pipe003", ROOT);
  expect(performance.now() - start).toBeLessThan(3_000); // không chờ hết 5s
  expect(r.compact).toContain("timeout");
});
