import { test, expect } from "bun:test";
import { runAndCompress } from "../src/pipeline";
import { defaultConfig } from "../src/config";
import { showRun } from "../src/store";
import { rmSync } from "fs";

test("chạy lệnh => nén + lưu full + giữ exit code", async () => {
  rmSync(".kt/runs", { recursive: true, force: true });
  const r = await runAndCompress(["sh", "-c", "exit 0"], defaultConfig, () => "pipe001");
  expect(r.exitCode).toBe(0);
  expect(showRun("pipe001")).not.toBeNull();
});

test("exit code khác 0 được truyền ra", async () => {
  const r = await runAndCompress(["sh", "-c", "exit 7"], defaultConfig, () => "pipe002");
  expect(r.exitCode).toBe(7);
});
