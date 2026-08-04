import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Profile } from "./detect";
import type { GenericOpts } from "./compressors/types";
import type { PricingTable } from "./cost";

export interface GuardConfig {
  maxCatKb: number;
  maxReadKb: number;
  rules: Record<string, boolean>;
}

export interface Config {
  profiles: Record<Profile, boolean>;
  generic: GenericOpts;
  limits: { maxChars: number };
  run: { timeoutMs: number; rawUnderChars: number };
  store: { keepRuns: number };
  statusline: { warnPct: number; dangerPct: number };
  guard: GuardConfig;
  promptGuard: import("./hooks/prompt").PromptGuardConfig;
  pricing: PricingTable;
}

export const defaultConfig: Config = {
  profiles: { test: true, build: true, install: true, git: true, lint: true, generic: true },
  // thresholdLines 0 = no head/tail trimming for the generic profile; rely on limits.maxChars alone.
  // Cutting the middle out of grep/sed/ls loses the signal → forces a `kt show` = an extra turn.
  generic: { thresholdLines: 0, headLines: 15, tailLines: 10 },
  limits: { maxChars: 16_000 }, // ~4k tokens; the backstop after every compressor
  // timeoutMs: an e2e suite slower than 2 minutes → raise it in that project's kt.json.
  // rawUnderChars: output below the threshold (~1k tokens) is returned VERBATIM, uncompressed — kt bench
  // on 2026-07-05 measured that compressing small output costs the model an extra verification turn
  // (+34% ctx), losing more than the compression saves. 0 = disabled.
  run: { timeoutMs: 120_000, rawUnderChars: 4000 },
  store: { keepRuns: 50 },
  statusline: { warnPct: 60, dangerPct: 85 },
  guard: { maxCatKb: 100, maxReadKb: 500, rules: { findRoot: true, npmLs: true, treeNoDepth: true, gitLogP: true, catBig: true, readNoise: true } },
  // Block the first turn after the cache dies (1h TTL) to ask: continue the old session, or use
  // `kt handoff --recover` for cheap. It blocks BEFORE the request leaves the machine, so the reload
  // is never paid for. 0 = disabled.
  promptGuard: { idleMin: 60, minTokens: 50_000 },
  // USD per 1M tokens, matched by model-id prefix. Prices change over time → edit them in kt.json;
  // a model absent from here is skipped by `kt cost` (better to omit than to report the wrong money).
  pricing: {
    "claude-fable-5": { input: 10, output: 50 },
    "claude-mythos-5": { input: 10, output: 50 },
    "claude-opus-5": { input: 5, output: 25 },
    "claude-opus-4-8": { input: 5, output: 25 },
    "claude-opus-4-7": { input: 5, output: 25 },
    "claude-opus-4-6": { input: 5, output: 25 },
    "claude-sonnet-5": { input: 3, output: 15 },
    "claude-sonnet-4-6": { input: 3, output: 15 },
    "claude-haiku-4-5": { input: 1, output: 5 },
  },
};

export function loadConfig(cwd: string = process.cwd()): Config {
  const path = join(cwd, "kt.json");
  if (!existsSync(path)) return defaultConfig;
  try {
    const user = JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
    return {
      ...defaultConfig,
      ...user,
      profiles: { ...defaultConfig.profiles, ...user.profiles },
      generic: { ...defaultConfig.generic, ...user.generic },
      limits: { ...defaultConfig.limits, ...user.limits },
      run: { ...defaultConfig.run, ...user.run },
      store: { ...defaultConfig.store, ...user.store },
      statusline: { ...defaultConfig.statusline, ...user.statusline },
      guard: { ...defaultConfig.guard, ...user.guard, rules: { ...defaultConfig.guard.rules, ...user.guard?.rules } },
      promptGuard: { ...defaultConfig.promptGuard, ...user.promptGuard },
      pricing: { ...defaultConfig.pricing, ...user.pricing },
    };
  } catch {
    return defaultConfig;
  }
}
