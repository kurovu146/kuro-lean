import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Profile } from "./detect";
import type { GenericOpts } from "./compressors/types";

export interface GuardConfig {
  maxCatKb: number;
  maxReadKb: number;
  rules: Record<string, boolean>;
}

export interface Config {
  profiles: Record<Profile, boolean>;
  generic: GenericOpts;
  limits: { maxChars: number };
  store: { keepRuns: number };
  statusline: { warnPct: number; dangerPct: number };
  guard: GuardConfig;
}

export const defaultConfig: Config = {
  profiles: { test: true, build: true, install: true, git: true, lint: true, generic: true },
  generic: { thresholdLines: 40, headLines: 15, tailLines: 10 },
  limits: { maxChars: 16_000 }, // ~4k token; chốt chặn sau mọi compressor
  store: { keepRuns: 50 },
  statusline: { warnPct: 60, dangerPct: 85 },
  guard: { maxCatKb: 100, maxReadKb: 500, rules: { findRoot: true, npmLs: true, treeNoDepth: true, gitLogP: true, catBig: true, readNoise: true } },
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
      store: { ...defaultConfig.store, ...user.store },
      statusline: { ...defaultConfig.statusline, ...user.statusline },
      guard: { ...defaultConfig.guard, ...user.guard, rules: { ...defaultConfig.guard.rules, ...user.guard?.rules } },
    };
  } catch {
    return defaultConfig;
  }
}
