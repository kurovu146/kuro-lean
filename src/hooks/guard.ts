import { existsSync, statSync } from "fs";
import type { GuardConfig } from "../config";

interface Rule {
  key: string;
  test: (cmd: string) => boolean;
  reason: string;
}

/**
 * Chặn `cat <file-lớn>` vì nó đổ nguyên file vào context.
 * Chỉ áp cho `cat` — head/tail vốn tự giới hạn dòng nên không cần chặn.
 * Trả lý do nếu có file > maxCatKb, ngược lại null.
 */
function checkCatBig(command: string, maxCatKb: number): string | null {
  const tokens = command.trim().split(/\s+/);
  const bin = (tokens[0] ?? "").split("/").pop();
  if (bin !== "cat") return null;
  const limit = maxCatKb * 1024;
  for (const tok of tokens.slice(1)) {
    if (tok.startsWith("-")) continue; // bỏ flag
    if (!existsSync(tok)) continue;
    try {
      const { size } = statSync(tok);
      if (size > limit) {
        const kb = Math.round(size / 1024);
        return `\`cat ${tok}\` đổ cả file ${kb}KB (> ${maxCatKb}KB) vào context → ngốn token. Dùng sed -n '1,200p' ${tok}, rg, hoặc đọc range thay vì cat.`;
      }
    } catch {
      // không stat được → bỏ qua
    }
  }
  return null;
}

const RULES: Rule[] = [
  {
    key: "findRoot",
    test: (c) => /\bfind\s+\/(\s|$)/.test(c),
    reason: "`find /` quét toàn ổ đĩa → cực ngốn token. Hãy scope: find ./thư-mục ...",
  },
  {
    key: "npmLs",
    test: (c) => /\bnpm ls\b/.test(c) && !/--depth/.test(c),
    reason: "`npm ls` in cả cây phụ thuộc. Thêm --depth=0 cho gọn.",
  },
  {
    key: "treeNoDepth",
    test: (c) => /\btree\b/.test(c) && !/-L\s*\d/.test(c),
    reason: "`tree` không giới hạn độ sâu. Thêm -L 2.",
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
