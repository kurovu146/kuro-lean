import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// Trim the noise: tool_result and tool input are what inflate a transcript to megabytes,
// while the next session only needs to know what was touched, not the verbatim text.
const RESULT_CAP = 200;
const TOOL_INPUT_CAP = 200;
const TEXT_CAP = 800;

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/**
 * Extract the END of a transcript into compact text (PURE).
 * Drops thinking (can't be replayed, and the next session doesn't need it), clips tool_result/tool input.
 * Measured on a real session: the last 60 messages ≈ 0.1% of the transcript size and still enough context.
 */
export function extractTail(lines: string[], nMessages: number): string {
  const out: string[] = [];
  for (const line of lines.slice(-nMessages)) {
    if (!line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // a corrupt line → skip it, don't kill the whole extract
    }
    const m = e?.message;
    const role = m?.role;
    if (role !== "user" && role !== "assistant") continue;

    const parts: string[] = [];
    const c = m.content;
    if (typeof c === "string") {
      parts.push(clip(c, TEXT_CAP));
    } else if (Array.isArray(c)) {
      for (const it of c) {
        if (!it || typeof it !== "object") continue;
        if (it.type === "text") {
          parts.push(clip(it.text ?? "", TEXT_CAP));
        } else if (it.type === "tool_use") {
          parts.push(`[used ${it.name}: ${clip(JSON.stringify(it.input ?? {}), TOOL_INPUT_CAP)}]`);
        } else if (it.type === "tool_result") {
          const cc = it.content;
          const s = Array.isArray(cc)
            ? cc.map((x: any) => (x && typeof x === "object" ? x.text ?? "" : "")).join("")
            : String(cc ?? "");
          parts.push(`[result: ${clip(s, RESULT_CAP)}]`);
        }
        // thinking: dropped entirely
      }
    }
    const body = parts.filter((p) => p.trim()).join("\n");
    if (body) out.push(`### ${role}\n${body}`);
  }
  return out.join("\n\n");
}

/** The most recently written transcript in a project's session directory. null when there is none. */
export function latestTranscript(dir: string): string | null {
  if (!existsSync(dir)) return null;
  let best: { path: string; mtime: number } | null = null;
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(dir, f);
      try {
        const mt = statSync(p).mtimeMs;
        if (!best || mt > best.mtime) best = { path: p, mtime: mt };
      } catch {}
    }
  } catch {
    return null;
  }
  return best?.path ?? null;
}

/** The extract plus instructions, ready to paste into a new session. */
export function recoverPrompt(tail: string, sourceFile: string): string {
  if (!tail) return `(no usable content could be read from ${sourceFile})\n`;
  return `This is the tail of a previous working session (extracted from \`${sourceFile}\`, with long output trimmed).
Read it to pick up the state, summarise for me where things stand and what the next step is, then wait for my confirmation before doing anything.

---

${tail}
`;
}
