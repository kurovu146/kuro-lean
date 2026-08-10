import { test, expect } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { loadConfig, defaultConfig } from "../src/config";

const ROOT = "/tmp/kt-test-config";
const DIR = join(ROOT, "project");
const HOME = join(ROOT, "home");

// `home` is injected, never homedir(): reading the real ~/.claude/kt.json would make every
// assertion below depend on whichever machine runs it.
const load = () => loadConfig(DIR, HOME);
const project = (cfg: unknown) => writeFileSync(join(DIR, "kt.json"), JSON.stringify(cfg));
const globalCfg = (cfg: unknown) => writeFileSync(join(HOME, ".claude", "kt.json"), JSON.stringify(cfg));

function setup(): void {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  mkdirSync(join(HOME, ".claude"), { recursive: true });
}

test("no kt.json anywhere => defaults", () => {
  setup();
  expect(load().generic.thresholdLines).toBe(defaultConfig.generic.thresholdLines);
});

test("kt.json overrides merge shallowly", () => {
  setup();
  project({ generic: { thresholdLines: 5, headLines: 2, tailLines: 1 } });
  expect(load().generic.thresholdLines).toBe(5);
  expect(load().store.keepRuns).toBe(defaultConfig.store.keepRuns);
});

test("run.timeoutMs: defaults to 120s and merges from kt.json", () => {
  setup();
  expect(defaultConfig.run.timeoutMs).toBe(120_000);
  project({ run: { timeoutMs: 300_000 } });
  expect(load().run.timeoutMs).toBe(300_000);
  // overriding one field of run must NOT drop the other defaults (shallow-merge regression guard)
  expect(load().run.rawUnderChars).toBe(4000);
});

test("run.rawUnderChars: merges from kt.json, keeps the default timeoutMs", () => {
  setup();
  project({ run: { rawUnderChars: 0 } });
  expect(load().run.rawUnderChars).toBe(0);
  expect(load().run.timeoutMs).toBe(120_000);
});

test("limits.maxChars: has a default and merges from kt.json", () => {
  setup();
  expect(defaultConfig.limits.maxChars).toBe(16_000);
  project({ limits: { maxChars: 5_000 } });
  expect(load().limits.maxChars).toBe(5_000);
});

test("~/.claude/kt.json applies with no project file — the point of the global layer", () => {
  setup();
  globalCfg({ promptGuard: { idleMin: 30 } });
  expect(load().promptGuard.idleMin).toBe(30);
  // a global override must not wipe its siblings either
  expect(load().promptGuard.minTokens).toBe(defaultConfig.promptGuard.minTokens);
});

test("project kt.json wins over the global one for the same key", () => {
  setup();
  globalCfg({ promptGuard: { idleMin: 30 } });
  project({ promptGuard: { idleMin: 5 } });
  expect(load().promptGuard.idleMin).toBe(5);
});

test("global and project merge per section, not whole-file", () => {
  setup();
  globalCfg({ promptGuard: { idleMin: 30 }, run: { timeoutMs: 300_000 } });
  project({ promptGuard: { minTokens: 1_000 } });
  const c = load();
  expect(c.promptGuard.idleMin).toBe(30); // survives from the global layer
  expect(c.promptGuard.minTokens).toBe(1_000); // set by the project
  expect(c.run.timeoutMs).toBe(300_000); // untouched section still comes from global
});

test("a malformed global is ignored without costing the project its config", () => {
  setup();
  writeFileSync(join(HOME, ".claude", "kt.json"), "{ this is not json");
  project({ limits: { maxChars: 5_000 } });
  expect(load().limits.maxChars).toBe(5_000);
  expect(load().promptGuard.idleMin).toBe(defaultConfig.promptGuard.idleMin);
});
