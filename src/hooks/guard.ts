import { existsSync, statSync } from "fs";
import { basename } from "path";
import type { GuardConfig } from "../config";

interface Rule {
  key: string;
  test: (cmd: string) => boolean;
  reason: string;
}

// A Read with an offset/limit below this threshold = the agent deliberately reading one slice → allow it.
const INTENTIONAL_READ_LIMIT = 400;

const NOISE_NAMES = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
  "go.sum", "Cargo.lock", "composer.lock", "Gemfile.lock", "poetry.lock", "Pipfile.lock", "flake.lock",
]);
const NOISE_EXT_RE = /\.min\.(js|css)$|\.map$/;
const NOISE_DIR_RE = /(^|\/)(node_modules|dist|build|\.next|out|vendor|coverage)\//;

/**
 * Block `Read` on whole noisy files (lock/generated/minified/vendor, or > maxReadKb): expensive in
 * tokens, little signal for understanding the code. Allowed when the agent reads deliberately (a small
 * offset/limit). Returns a reason when it should be blocked, otherwise null.
 */
export function checkNoisyRead(
  input: { file_path?: string; offset?: number; limit?: number },
  cfg: GuardConfig,
): string | null {
  if (!cfg.rules.readNoise) return null;
  const fp = input.file_path;
  if (!fp) return null;

  // the escape hatch: a deliberate slice read
  if (input.offset != null) return null;
  if (input.limit != null && input.limit <= INTENTIONAL_READ_LIMIT) return null;

  const base = basename(fp);
  let why: string | null = null;
  if (NOISE_NAMES.has(base)) why = "lock file";
  else if (NOISE_EXT_RE.test(fp)) why = "file generated/minified";
  else if (NOISE_DIR_RE.test(fp)) why = "a file inside a vendor/build directory";
  else if (existsSync(fp)) {
    try {
      const size = statSync(fp).size;
      if (size > cfg.maxReadKb * 1024) why = `file lớn ${Math.round(size / 1024)}KB (> ${cfg.maxReadKb}KB)`;
    } catch {
      // couldn't stat it → skip
    }
  }
  if (!why) return null;
  return `\`Read ${base}\` is ${why} → expensive in tokens, little signal. Need one specific slice? Read with a small limit (e.g. limit:200), or use Grep to find the exact line. Temporarily disable: KT_DISABLE=1.`;
}

/**
 * Block `cat <big-file>`, because it dumps the whole file into the context.
 * Only applies to `cat` — head/tail already limit their line count, so they need no block.
 * Returns a reason when a file exceeds maxCatKb, otherwise null.
 */
function checkCatBig(command: string, maxCatKb: number): string | null {
  const tokens = command.trim().split(/\s+/);
  const bin = (tokens[0] ?? "").split("/").pop();
  if (bin !== "cat") return null;
  const limit = maxCatKb * 1024;
  for (const tok of tokens.slice(1)) {
    if (tok.startsWith("-")) continue; // skip flags
    if (!existsSync(tok)) continue;
    try {
      const { size } = statSync(tok);
      if (size > limit) {
        const kb = Math.round(size / 1024);
        return `\`cat ${tok}\` dumps the whole ${kb}KB file (> ${maxCatKb}KB) into the context → token-hungry. Use sed -n '1,200p' ${tok}, rg, or read a range instead of cat.`;
      }
    } catch {
      // couldn't stat it → skip
    }
  }
  return null;
}

const RULES: Rule[] = [
  {
    key: "findRoot",
    test: (c) => /\bfind\s+\/(\s|$)/.test(c),
    reason: "`find /` scans the entire disk → extremely token-hungry. Scope it: find ./directory ...",
  },
  {
    key: "npmLs",
    test: (c) => /\bnpm ls\b/.test(c) && !/--depth/.test(c),
    reason: "`npm ls` prints the whole dependency tree. Add --depth=0 to keep it short.",
  },
  {
    key: "gitLogP",
    // `git log` must be in COMMAND position (line start, or after | ; &) — avoids a false positive when
    // "git log -p" sits inside a string, e.g. a commit message describing this very rule.
    test: (c) => /(?:^|[|;&])\s*git\s+log\b/.test(c) && /(^|\s)(-p|--patch)(\s|$)/.test(c),
    reason: "`git log -p` dumps the full patch of every commit → token-hungry. Use git log --oneline, then git show <sha> -- <file> when you need to read one change.",
  },
  {
    key: "treeNoDepth",
    // only match when `tree` is the COMMAND (line start, or after | ; &) — avoids a false positive
    // when "tree" is an argument or search string, e.g. grep "tree" src/
    test: (c) => /(?:^|[|;&])\s*tree\b/.test(c) && !/-L\s*\d/.test(c),
    reason: "`tree` has no depth limit. Add -L 2.",
  },
];

export function decideGuard(command: string, cfg: GuardConfig): { deny: boolean; reason?: string } {
  for (const rule of RULES) {
    if (cfg.rules[rule.key] && rule.test(command)) {
      return { deny: true, reason: rule.reason };
    }
  }
  if (cfg.rules.catBig) {
    const reason = checkCatBig(command, cfg.maxCatKb);
    if (reason) return { deny: true, reason };
  }
  return { deny: false };
}
