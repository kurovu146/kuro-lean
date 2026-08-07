import { existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import { CACHE_READ_MULT, CACHE_WRITE_MULT, priceOf, type Price, type PricingTable } from "../cost";
import { fmtIdle } from "../statusline";
import { idleMinutes, lastActivity } from "../transcript";

/**
 * Warn BEFORE the request leaves the machine. The status line only redraws AFTER the turn was sent,
 * so it is a receipt rather than a warning — by the time you see "cache dead" you have already paid.
 * UserPromptSubmit runs first, and `decision: "block"` cancels that turn outright => it costs nothing.
 */

export interface PromptFacts {
  idleMinutes: number;
  tokens: number;
  price: Price | null;
  alreadyWarned: boolean;
}

export interface PromptGuardConfig {
  idleMin: number;
  /** Below this, a reload is worth pennies — blocking would only be annoying. */
  minTokens: number;
}

/** Should this turn be blocked (PURE). null = let it through. */
export function decidePromptGuard(f: PromptFacts, cfg: PromptGuardConfig): { reason: string } | null {
  if (cfg.idleMin <= 0) return null; // disabled
  if (f.idleMinutes < cfg.idleMin) return null; // cache still alive, and sending extends its TTL
  if (f.alreadyWarned) return null; // already warned for this particular expiry → don't loop
  if (f.tokens < cfg.minTokens) return null;

  const tok = `${Math.round(f.tokens / 1000)}k tokens`;
  const money = f.price
    ? ` at the cache-write rate (${CACHE_WRITE_MULT}× input) ≈ $${((f.tokens / 1e6) * f.price.input * CACHE_WRITE_MULT).toFixed(2)}` +
      `, plus ~$${((f.tokens / 1e6) * f.price.input * CACHE_READ_MULT).toFixed(2)} per turn after that to re-read it`
    : "";

  return {
    reason:
      `❄️ The context cache has expired — this session has been idle ${fmtIdle(f.idleMinutes)} (TTL ${cfg.idleMin} min).\n` +
      `Sending this turn reloads all ~${tok}${money}.\n\n` +
      `kt blocks EXACTLY ONCE so you can choose:\n` +
      `  • Continue this session → press ↑ then Enter (your prompt is still in the history). The next turn won't be blocked.\n` +
      `  • Much cheaper → /clear, then run \`kt handoff --recover\` and paste the result: it carries the work in progress over in a few thousand tokens.`,
  };
}

// ---- I/O ----

export interface LastContext {
  tokens: number;
  model: string;
}

/**
 * The usage of the LAST turn in the transcript = the size of the context being reloaded.
 * Summing the whole session is wrong: every turn re-reads the same context, it isn't new context.
 */
export function lastContext(transcriptPath: string): LastContext {
  let text: string;
  try {
    text = readFileSync(transcriptPath, "utf8");
  } catch {
    return { tokens: 0, model: "" };
  }
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const u = e?.message?.usage;
    if (!u || typeof u !== "object") continue;
    return {
      tokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      model: e.message.model ?? "",
    };
  }
  return { tokens: 0, model: "" };
}

export function lastContextTokens(transcriptPath: string): number {
  return lastContext(transcriptPath).tokens;
}

/** A marker anchored to the last activity: one expiry gets blocked exactly once. */
export function markerPath(transcriptPath: string): string {
  const key = createHash("md5").update(transcriptPath).digest("hex").slice(0, 8);
  return join(tmpdir(), `kt-idle-${key}.json`);
}

export function hasWarned(statePath: string, mtime: number): boolean {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"))?.mtime === mtime;
  } catch {
    return false;
  }
}

export function markWarned(statePath: string, mtime: number): void {
  try {
    writeFileSync(statePath, JSON.stringify({ mtime }));
  } catch {}
}

export interface PromptHookInput {
  transcript_path?: string;
  cwd?: string;
}

/**
 * The whole hook: returns a JSON string for stdout, or null to stay out of the way.
 * The transcript is only read once mtime passes the threshold — a normal turn costs one stat().
 */
export function promptGuardOutput(
  input: PromptHookInput,
  cfg: { promptGuard: PromptGuardConfig; pricing: PricingTable },
  now: number = Date.now(),
): string | null {
  const { idleMin, minTokens } = cfg.promptGuard ?? { idleMin: 0, minTokens: 0 };
  if (idleMin <= 0) return null;

  // ONLY the transcript of this very session. No file (the first turn of a new session — Claude Code
  // writes the transcript after the turn starts) means the context is still empty: nothing to reload.
  // This used to fall back to the project's most recent session, which unfairly blocked every panel
  // opened next to an abandoned one — taking someone else's numbers and pinning them on this session.
  const path = input.transcript_path;
  if (!path || !existsSync(path)) return null;

  // NOT the file's mtime. Claude Code appends bookkeeping (file-history-snapshot, ai-title, mode…)
  // while the panel sits untouched, so mtime always undercounts: a panel idle 3h38m reported 22m.
  // Costs one bounded 64KB tail read per prompt — the price of a number that is actually true.
  const idle = idleMinutes(path, now);
  if (idle < idleMin) return null;

  const state = markerPath(path);
  const activity = lastActivity(path);
  const { tokens, model } = lastContext(path);
  const decision = decidePromptGuard(
    {
      idleMinutes: idle,
      tokens,
      price: model ? priceOf(model, cfg.pricing) : null,
      alreadyWarned: hasWarned(state, activity),
    },
    { idleMin, minTokens },
  );
  if (!decision) return null;

  markWarned(state, activity);
  return JSON.stringify({ decision: "block", reason: decision.reason });
}
