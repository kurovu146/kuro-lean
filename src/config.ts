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
  // Chặn lượt đầu tiên sau khi cache chết (TTL 1h) để hỏi lại: tiếp phiên cũ hay `kt handoff
  // --recover` cho rẻ. Chặn TRƯỚC khi request rời máy nên không mất tiền nạp lại. 0 = tắt.
  promptGuard: { idleMin: 60, minTokens: 50_000 },
  // USD/1M token, khớp theo tiền tố model id. Giá đổi theo thời gian → sửa trong kt.json,
  // model không có ở đây thì `kt cost` bỏ qua (thà thiếu còn hơn báo sai tiền).
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
