import { test, expect } from "bun:test";
import { runAndCompress } from "../src/pipeline";
import { defaultConfig } from "../src/config";
import { showRun, readMeta } from "../src/store";
import { rmSync } from "fs";

// Dùng store tmp riêng — KHÔNG đụng .kt/runs thật của repo.
const ROOT = "/tmp/kt-test-pipeline";

test("rawUnderChars: 0 => tắt pass-through, output rỗng vẫn nén + lưu + giữ exit code", async () => {
  rmSync(ROOT, { recursive: true, force: true });
  const cfg = { ...defaultConfig, run: { ...defaultConfig.run, rawUnderChars: 0 } };
  const r = await runAndCompress(["sh", "-c", "exit 0"], cfg, () => "pipe001", ROOT);
  expect(r.exitCode).toBe(0);
  expect(showRun("pipe001", ROOT)).not.toBeNull();
});

test("exit code khác 0 được truyền ra", async () => {
  const r = await runAndCompress(["sh", "-c", "exit 7"], defaultConfig, () => "pipe002", ROOT);
  expect(r.exitCode).toBe(7);
});

test("run.timeoutMs từ config được áp: lệnh chậm bị kill + báo timeout", async () => {
  const cfg = { ...defaultConfig, run: { ...defaultConfig.run, timeoutMs: 150 } };
  const start = performance.now();
  const r = await runAndCompress(["sleep", "5"], cfg, () => "pipe003", ROOT);
  expect(performance.now() - start).toBeLessThan(3_000); // không chờ hết 5s
  expect(r.compact).toContain("timeout");
});

test("output nhỏ hơn run.rawUnderChars => pass-through NGUYÊN VĂN, không lưu log/meta", async () => {
  const R2 = "/tmp/kt-test-pipeline-raw";
  rmSync(R2, { recursive: true, force: true });
  const r = await runAndCompress(["sh", "-c", "printf 'hello\\nworld'"], defaultConfig, () => "pipeRAW1", R2);
  expect(r.compact).toBe("hello\nworld"); // không header/footer/marker gì thêm
  expect(r.exitCode).toBe(0);
  expect(showRun("pipeRAW1", R2)).toBeNull();
  expect(readMeta(R2).length).toBe(0);
});

test("output từ ngưỡng trở lên => vẫn nén + lưu log + ghi meta như cũ", async () => {
  const R3 = "/tmp/kt-test-pipeline-big";
  rmSync(R3, { recursive: true, force: true });
  const cfg = { ...defaultConfig, run: { ...defaultConfig.run, rawUnderChars: 100 } };
  // ~23.9k chars — vượt limits.maxChars (16k) nên bị cap cắt. Generic không còn cắt head/tail
  // theo dòng nữa, cap ký tự là cơ chế nén duy nhất của nó.
  const r = await runAndCompress(["sh", "-c", "seq 1 5000"], cfg, () => "pipeBIG1", R3);
  expect(showRun("pipeBIG1", R3)).not.toBeNull();
  const meta = readMeta(R3);
  expect(meta.length).toBe(1);
  expect(meta[0]!.originalChars).toBeGreaterThan(100);
  expect(r.compact.length).toBeLessThan(meta[0]!.originalChars); // thực sự có nén
});

test("generic dưới cap => giữ NGUYÊN VĂN (không cắt giữa, khỏi tốn turn kt show)", async () => {
  const R3b = "/tmp/kt-test-pipeline-nocut";
  rmSync(R3b, { recursive: true, force: true });
  const cfg = { ...defaultConfig, run: { ...defaultConfig.run, rawUnderChars: 100 } };
  const r = await runAndCompress(["sh", "-c", "seq 1 200"], cfg, () => "pipeNOCUT", R3b); // ~692 ch, 200 dòng
  expect(r.compact).not.toContain("dòng đã ẩn");
  expect(r.compact.split("\n").filter(Boolean).length).toBe(200);
  expect(readMeta(R3b).length).toBe(1); // vẫn ghi meta để `kt stats` thấy
});

test("mặc định rawUnderChars = 4000", () => {
  expect(defaultConfig.run.rawUnderChars).toBe(4000);
});

test("output ĐÚNG BẰNG ngưỡng => nén (pass-through chỉ khi NHỎ HƠN)", async () => {
  const R4 = "/tmp/kt-test-pipeline-eq";
  rmSync(R4, { recursive: true, force: true });
  // printf 'aaaaaaaaaa' (10 chars) với ngưỡng 10 → không pass-through → có lưu log
  const cfg = { ...defaultConfig, run: { ...defaultConfig.run, rawUnderChars: 10 } };
  await runAndCompress(["sh", "-c", "printf 'aaaaaaaaaa'"], cfg, () => "pipeEQ1", R4);
  expect(showRun("pipeEQ1", R4)).not.toBeNull();
});
