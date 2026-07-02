import type { RunMeta } from "./store";

function fmtK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/**
 * Tổng hợp tiết kiệm từ metadata các run (PURE — dữ liệu từ readMeta).
 * Top xếp theo chars SAU nén: đó là phần thực sự còn vào context → ứng viên
 * để nén thêm / thêm guard, biến việc tối ưu thành data-driven.
 */
export function renderStats(entries: RunMeta[]): string {
  if (entries.length === 0) return "(chưa có dữ liệu — chạy vài lệnh qua kt run trước đã)\n";

  let orig = 0;
  let compact = 0;
  const byCmd = new Map<string, { orig: number; compact: number; runs: number }>();
  for (const e of entries) {
    orig += e.originalChars;
    compact += e.compactChars;
    const c = byCmd.get(e.command) ?? { orig: 0, compact: 0, runs: 0 };
    c.orig += e.originalChars;
    c.compact += e.compactChars;
    c.runs += 1;
    byCmd.set(e.command, c);
  }
  const saved = orig - compact;
  const pct = orig > 0 ? Math.round((saved / orig) * 100) : 0;

  const lines = [
    `${entries.length} run · raw ${fmtK(orig)} ch → còn ${fmtK(compact)} ch · tiết kiệm ${pct}% (~${fmtK(Math.round(saved / 4))} token)`,
    "",
    "Top lệnh còn chiếm context (chars sau nén):",
  ];
  const top = [...byCmd.entries()].sort((a, b) => b[1].compact - a[1].compact).slice(0, 5);
  for (const [cmd, c] of top) {
    const p = c.orig > 0 ? Math.round(((c.orig - c.compact) / c.orig) * 100) : 0;
    lines.push(`  ${fmtK(c.compact).padStart(6)} ch · ${String(c.runs).padStart(3)} run · nén ${p}% · ${cmd}`);
  }
  return lines.join("\n") + "\n";
}
