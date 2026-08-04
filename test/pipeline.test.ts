import { test, expect } from "bun:test";
import { runAndCompress } from "../src/pipeline";
import { defaultConfig } from "../src/config";
import { showRun, readMeta } from "../src/store";
import { rmSync } from "fs";

// Uses its own tmp store - never touches the real .kt/runs of this repo.
const ROOT = "/tmp/kt-test-pipeline";

test("rawUnderChars: 0 => pass-through off, even empty output is compressed + stored + keeps the exit code", async () => {
  rmSync(ROOT, { recursive: true, force: true });
  const cfg = { ...defaultConfig, run: { ...defaultConfig.run, rawUnderChars: 0 } };
  const r = await runAndCompress(["sh", "-c", "exit 0"], cfg, () => "pipe001", ROOT);
  expect(r.exitCode).toBe(0);
  expect(showRun("pipe001", ROOT)).not.toBeNull();
});

test("a non-zero exit code is propagated", async () => {
  const r = await runAndCompress(["sh", "-c", "exit 7"], defaultConfig, () => "pipe002", ROOT);
  expect(r.exitCode).toBe(7);
});

test("run.timeoutMs from config is applied: a slow command is killed + reported as a timeout", async () => {
  const cfg = { ...defaultConfig, run: { ...defaultConfig.run, timeoutMs: 150 } };
  const start = performance.now();
  const r = await runAndCompress(["sleep", "5"], cfg, () => "pipe003", ROOT);
  expect(performance.now() - start).toBeLessThan(3_000); // does not wait the full 5s
  expect(r.compact).toContain("timeout");
});

test("output below run.rawUnderChars => passed through VERBATIM, no log/meta stored", async () => {
  const R2 = "/tmp/kt-test-pipeline-raw";
  rmSync(R2, { recursive: true, force: true });
  const r = await runAndCompress(["sh", "-c", "printf 'hello\\nworld'"], defaultConfig, () => "pipeRAW1", R2);
  expect(r.compact).toBe("hello\nworld"); // no extra header/footer/marker
  expect(r.exitCode).toBe(0);
  expect(showRun("pipeRAW1", R2)).toBeNull();
  expect(readMeta(R2).length).toBe(0);
});

test("output at or above the threshold => compressed + logged + meta written as before", async () => {
  const R3 = "/tmp/kt-test-pipeline-big";
  rmSync(R3, { recursive: true, force: true });
  const cfg = { ...defaultConfig, run: { ...defaultConfig.run, rawUnderChars: 100 } };
  // ~23.9k chars - over limits.maxChars (16k) so the cap trims it. Generic no longer trims head/tail
  // by line, so the character cap is its only compression mechanism.
  const r = await runAndCompress(["sh", "-c", "seq 1 5000"], cfg, () => "pipeBIG1", R3);
  expect(showRun("pipeBIG1", R3)).not.toBeNull();
  const meta = readMeta(R3);
  expect(meta.length).toBe(1);
  expect(meta[0]!.originalChars).toBeGreaterThan(100);
  expect(r.compact.length).toBeLessThan(meta[0]!.originalChars); // genuinely compressed
});

test("generic below the cap => kept VERBATIM (no middle cut, no wasted kt show turn)", async () => {
  const R3b = "/tmp/kt-test-pipeline-nocut";
  rmSync(R3b, { recursive: true, force: true });
  const cfg = { ...defaultConfig, run: { ...defaultConfig.run, rawUnderChars: 100 } };
  const r = await runAndCompress(["sh", "-c", "seq 1 200"], cfg, () => "pipeNOCUT", R3b); // ~692 ch, 200 lines
  expect(r.compact).not.toContain("lines hidden");
  expect(r.compact.split("\n").filter(Boolean).length).toBe(200);
  expect(readMeta(R3b).length).toBe(1); // meta is still written so `kt stats` sees it
});

test("rawUnderChars defaults to 4000", () => {
  expect(defaultConfig.run.rawUnderChars).toBe(4000);
});

test("output EXACTLY at the threshold => compressed (pass-through is strictly BELOW)", async () => {
  const R4 = "/tmp/kt-test-pipeline-eq";
  rmSync(R4, { recursive: true, force: true });
  // printf 'aaaaaaaaaa' (10 chars) with a threshold of 10 -> no pass-through -> a log is stored
  const cfg = { ...defaultConfig, run: { ...defaultConfig.run, rawUnderChars: 10 } };
  await runAndCompress(["sh", "-c", "printf 'aaaaaaaaaa'"], cfg, () => "pipeEQ1", R4);
  expect(showRun("pipeEQ1", R4)).not.toBeNull();
});
