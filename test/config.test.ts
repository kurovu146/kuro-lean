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

test("limits.maxChars: có default và merge được từ kt.json", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  expect(defaultConfig.limits.maxChars).toBe(16_000);
  writeFileSync(`${DIR}/kt.json`, JSON.stringify({ limits: { maxChars: 5_000 } }));
  expect(loadConfig(DIR).limits.maxChars).toBe(5_000);
});
