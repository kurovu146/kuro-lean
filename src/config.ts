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
  run: { timeoutMs: number; rawUnderChars: number };
  store: { keepRuns: number };
  statusline: { warnPct: number; dangerPct: number };
  guard: GuardConfig;
}

export const defaultConfig: Config = {
  profiles: { test: true, build: true, install: true, git: true, lint: true, generic: true },
  // thresholdLines 0 = không cắt head/tail cho profile generic; chỉ dựa vào limits.maxChars.
  // Cắt giữa của grep/sed/ls làm model mất tín hiệu → phải `kt show` = thêm turn.
  generic: { thresholdLines: 0, headLines: 15, tailLines: 10 },
  limits: { maxChars: 16_000 }, // ~4k token; chốt chặn sau mọi compressor
  // timeoutMs: suite e2e chậm hơn 2' → tăng trong kt.json của project đó.
  // rawUnderChars: output nhỏ hơn ngưỡng (~1k token) trả NGUYÊN VĂN không nén — kt bench 2026-07-05
  // đo được nén output nhỏ làm model tốn thêm turn xác minh (+34% ctx), lỗ hơn phần nén được. 0 = tắt.
  run: { timeoutMs: 120_000, rawUnderChars: 4000 },
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
      run: { ...defaultConfig.run, ...user.run },
      store: { ...defaultConfig.store, ...user.store },
      statusline: { ...defaultConfig.statusline, ...user.statusline },
      guard: { ...defaultConfig.guard, ...user.guard, rules: { ...defaultConfig.guard.rules, ...user.guard?.rules } },
    };
  } catch {
    return defaultConfig;
  }
}
