import type { GuardConfig } from "../config";

interface Rule {
  key: string;
  test: (cmd: string) => boolean;
  reason: string;
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
  return { deny: false };
}
