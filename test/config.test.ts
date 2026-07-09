import { test, expect } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { loadConfig, defaultConfig } from "../src/config";

const DIR = "/tmp/kt-test-config";

test("không có kt.json => default", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  expect(loadConfig(DIR).generic.thresholdLines).toBe(defaultConfig.generic.thresholdLines);
});

test("kt.json override merge nông", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${DIR}/kt.json`, JSON.stringify({ generic: { thresholdLines: 5, headLines: 2, tailLines: 1 } }));
  expect(loadConfig(DIR).generic.thresholdLines).toBe(5);
  expect(loadConfig(DIR).store.keepRuns).toBe(defaultConfig.store.keepRuns);
});

test("run.timeoutMs: có default 120s và merge được từ kt.json", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  expect(defaultConfig.run.timeoutMs).toBe(120_000);
  writeFileSync(`${DIR}/kt.json`, JSON.stringify({ run: { timeoutMs: 300_000 } }));
  expect(loadConfig(DIR).run.timeoutMs).toBe(300_000);
  // override 1 field của run KHÔNG được làm rơi default field còn lại (chống regression merge nông)
  expect(loadConfig(DIR).run.rawUnderChars).toBe(4000);
});

test("run.rawUnderChars: merge được từ kt.json, giữ timeoutMs default", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${DIR}/kt.json`, JSON.stringify({ run: { rawUnderChars: 0 } }));
  expect(loadConfig(DIR).run.rawUnderChars).toBe(0);
  expect(loadConfig(DIR).run.timeoutMs).toBe(120_000);
});

test("limits.maxChars: có default và merge được từ kt.json", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  expect(defaultConfig.limits.maxChars).toBe(16_000);
  writeFileSync(`${DIR}/kt.json`, JSON.stringify({ limits: { maxChars: 5_000 } }));
  expect(loadConfig(DIR).limits.maxChars).toBe(5_000);
});
