import { test, expect } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { loadConfig, defaultConfig } from "../src/config";

const DIR = "/tmp/kt-test-config";

test("no kt.json => defaults", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  expect(loadConfig(DIR).generic.thresholdLines).toBe(defaultConfig.generic.thresholdLines);
});

test("kt.json overrides merge shallowly", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${DIR}/kt.json`, JSON.stringify({ generic: { thresholdLines: 5, headLines: 2, tailLines: 1 } }));
  expect(loadConfig(DIR).generic.thresholdLines).toBe(5);
  expect(loadConfig(DIR).store.keepRuns).toBe(defaultConfig.store.keepRuns);
});

test("run.timeoutMs: defaults to 120s and merges from kt.json", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  expect(defaultConfig.run.timeoutMs).toBe(120_000);
  writeFileSync(`${DIR}/kt.json`, JSON.stringify({ run: { timeoutMs: 300_000 } }));
  expect(loadConfig(DIR).run.timeoutMs).toBe(300_000);
  // overriding one field of run must NOT drop the other defaults (shallow-merge regression guard)
  expect(loadConfig(DIR).run.rawUnderChars).toBe(4000);
});

test("run.rawUnderChars: merges from kt.json, keeps the default timeoutMs", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${DIR}/kt.json`, JSON.stringify({ run: { rawUnderChars: 0 } }));
  expect(loadConfig(DIR).run.rawUnderChars).toBe(0);
  expect(loadConfig(DIR).run.timeoutMs).toBe(120_000);
});

test("limits.maxChars: has a default and merges from kt.json", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  expect(defaultConfig.limits.maxChars).toBe(16_000);
  writeFileSync(`${DIR}/kt.json`, JSON.stringify({ limits: { maxChars: 5_000 } }));
  expect(loadConfig(DIR).limits.maxChars).toBe(5_000);
});
