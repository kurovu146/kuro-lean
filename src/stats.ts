import type { RunMeta } from "./store";

function fmtK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/**
 * Aggregate savings from the runs' metadata (PURE — data comes from readMeta).
 * The top list is ranked by chars AFTER compression: that is what actually still enters the context →
 * the candidates for another pattern or guard, which makes optimising data-driven.
 */
export function renderStats(entries: RunMeta[]): string {
  if (entries.length === 0) return "(no data yet — run a few commands through kt run first)\n";

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
    `${entries.length} runs · raw ${fmtK(orig)} ch → ${fmtK(compact)} ch left · saved ${pct}% (~${fmtK(Math.round(saved / 4))} tokens)`,
    "",
    "Top commands still occupying context (chars after compression):",
  ];
  const top = [...byCmd.entries()].sort((a, b) => b[1].compact - a[1].compact).slice(0, 5);
  for (const [cmd, c] of top) {
    const p = c.orig > 0 ? Math.round(((c.orig - c.compact) / c.orig) * 100) : 0;
    lines.push(`  ${fmtK(c.compact).padStart(6)} ch · ${String(c.runs).padStart(3)} runs · compressed ${p}% · ${cmd}`);
  }
  return lines.join("\n") + "\n";
}
