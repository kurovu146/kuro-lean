import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, utimesSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  decidePromptGuard,
  hasWarned,
  markWarned,
  lastContextTokens,
  promptGuardOutput,
} from "../src/hooks/prompt";
import { defaultConfig, loadConfig } from "../src/config";
import { transcriptDir } from "../src/cost";

const PRICE = { input: 5, output: 25 };
const tmp = () => mkdtempSync(join(tmpdir(), "kt-prompt-"));

/** A fake transcript with one usage turn; mtime backdated `idleMin` minutes to fake an abandoned session. */
function fakeTranscript(tokens: number, idleMin: number, model = "claude-opus-5"): string {
  const f = join(tmp(), `${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(f, JSON.stringify({ message: { model, usage: { cache_read_input_tokens: tokens } } }));
  const t = new Date(Date.now() - idleMin * 60_000);
  utimesSync(f, t, t);
  return f;
}

test("cache still alive => don't block (blocking here is pointless interference)", () => {
  const d = decidePromptGuard(
    { idleMinutes: 42, tokens: 500_000, price: PRICE, alreadyWarned: false },
    { idleMin: 60, minTokens: 50_000 },
  );
  expect(d).toBeNull();
});

test("past the TTL => block, stating the idle time and the reload price", () => {
  const d = decidePromptGuard(
    { idleMinutes: 192, tokens: 500_000, price: PRICE, alreadyWarned: false },
    { idleMin: 60, minTokens: 50_000 },
  );
  expect(d).not.toBeNull();
  expect(d!.reason).toContain("3h12"); // 192 minutes
  expect(d!.reason).toContain("$5.00"); // 500k tok × $5/1M × 2 (cache write)
  expect(d!.reason).toContain("handoff --recover");
});

test("already warned for this particular expiry => let it through, don't loop", () => {
  const d = decidePromptGuard(
    { idleMinutes: 192, tokens: 500_000, price: PRICE, alreadyWarned: true },
    { idleMin: 60, minTokens: 50_000 },
  );
  expect(d).toBeNull();
});

test("idleMin = 0 => the feature is off entirely", () => {
  const d = decidePromptGuard(
    { idleMinutes: 9999, tokens: 500_000, price: PRICE, alreadyWarned: false },
    { idleMin: 0, minTokens: 50_000 },
  );
  expect(d).toBeNull();
});

test("no price for the model => still warn, just without the money (never invent a figure)", () => {
  const d = decidePromptGuard(
    { idleMinutes: 90, tokens: 300_000, price: null, alreadyWarned: false },
    { idleMin: 60, minTokens: 50_000 },
  );
  expect(d).not.toBeNull();
  expect(d!.reason).not.toContain("$");
});

test("small context => not worth blocking, reloading costs less than the annoyance", () => {
  const d = decidePromptGuard(
    { idleMinutes: 300, tokens: 8_000, price: PRICE, alreadyWarned: false },
    { idleMin: 60, minTokens: 50_000 },
  );
  expect(d).toBeNull();
});

test("lowering minTokens => blocks even a small context (for verification, and for pricier models)", () => {
  const d = decidePromptGuard(
    { idleMinutes: 300, tokens: 8_000, price: PRICE, alreadyWarned: false },
    { idleMin: 60, minTokens: 1_000 },
  );
  expect(d).not.toBeNull();
});

test("lastContextTokens: takes the LAST turn's usage, doesn't sum the session", () => {
  const dir = tmp();
  const f = join(dir, "t.jsonl");
  writeFileSync(f, [
    JSON.stringify({ message: { usage: { input_tokens: 5, cache_read_input_tokens: 100_000 } } }),
    JSON.stringify({ message: { usage: { input_tokens: 3, cache_creation_input_tokens: 2_000, cache_read_input_tokens: 400_000 } } }),
  ].join("\n"));
  expect(lastContextTokens(f)).toBe(402_003);
});

test("lastContextTokens: corrupt lines and lines without usage are skipped", () => {
  const dir = tmp();
  const f = join(dir, "t.jsonl");
  writeFileSync(f, [
    JSON.stringify({ message: { usage: { cache_read_input_tokens: 7_000 } } }),
    "{corrupt",
    JSON.stringify({ type: "summary" }),
  ].join("\n"));
  expect(lastContextTokens(f)).toBe(7_000);
});

test("lastContextTokens: missing file => 0, doesn't throw", () => {
  expect(lastContextTokens("/no/such/file.jsonl")).toBe(0);
});

test("marker: anchored to mtime — remembers one expiry, forgets a different one", () => {
  const p = join(tmp(), "state.json");
  expect(hasWarned(p, 1000)).toBe(false);
  markWarned(p, 1000);
  expect(hasWarned(p, 1000)).toBe(true);
  expect(hasWarned(p, 2000)).toBe(false);
});

// ---- promptGuardOutput: the whole hook assembled, which is what cli.ts calls ----

test("session just touched => stay quiet, don't read the transcript, don't block", () => {
  const out = promptGuardOutput({ transcript_path: fakeTranscript(600_000, 5) }, defaultConfig);
  expect(out).toBeNull();
});

test("session abandoned overnight => returns block JSON in Claude Code's schema", () => {
  const out = promptGuardOutput({ transcript_path: fakeTranscript(600_000, 300) }, defaultConfig);
  expect(out).not.toBeNull();
  const j = JSON.parse(out!);
  expect(j.decision).toBe("block");
  expect(j.reason).toContain("The context cache has expired");
  expect(j.reason).toContain("$6.00"); // 600k tok × $5/1M × 2
});

test("blocked once and done: resending straight after must go through", () => {
  const f = fakeTranscript(600_000, 300);
  expect(promptGuardOutput({ transcript_path: f }, defaultConfig)).not.toBeNull();
  expect(promptGuardOutput({ transcript_path: f }, defaultConfig)).toBeNull();
});

test("transcript missing and cwd has no sessions => stay quiet", () => {
  const out = promptGuardOutput({ transcript_path: "/no/such.jsonl", cwd: "/no/such/project" }, defaultConfig);
  expect(out).toBeNull();
});

test("a NEW session opened in a project with an abandoned one => quiet, must not grab another session's transcript", () => {
  // The FIRST turn of a session: Claude Code passes a correct transcript_path, but the file isn't
  // written yet (measured: the hook sees MISSING). Having no transcript for THIS session means the
  // context is still empty — nothing to reload, so stay quiet. Taking the project's most recent
  // session takes the wrong person's numbers.
  const cwd = tmp();
  const dir = transcriptDir(cwd);
  mkdirSync(dir, { recursive: true });
  try {
    const old = join(dir, "old-session.jsonl");
    writeFileSync(old, JSON.stringify({ message: { model: "claude-opus-5", usage: { cache_read_input_tokens: 600_000 } } }));
    const t = new Date(Date.now() - 300 * 60_000);
    utimesSync(old, t, t);

    const out = promptGuardOutput({ transcript_path: join(dir, "new-session.jsonl"), cwd }, defaultConfig);
    expect(out).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: promptGuard defaults to 60 minutes (matching the cache TTL) and 50k tokens", () => {
  expect(defaultConfig.promptGuard.idleMin).toBe(60);
  expect(defaultConfig.promptGuard.minTokens).toBe(50_000);
});

test("promptGuardOutput: minTokens comes from config, not a hardcoded value", () => {
  const f = fakeTranscript(8_000, 300);
  const cfg = { ...defaultConfig, promptGuard: { idleMin: 60, minTokens: 1_000 } };
  expect(promptGuardOutput({ transcript_path: f }, defaultConfig)).toBeNull();
  expect(promptGuardOutput({ transcript_path: f }, cfg)).not.toBeNull();
});

test("config: a kt.json setting only idleMin leaves the rest of the config intact", () => {
  const dir = tmp();
  writeFileSync(join(dir, "kt.json"), JSON.stringify({ promptGuard: { idleMin: 0 } }));
  const c = loadConfig(dir);
  expect(c.promptGuard.idleMin).toBe(0);
  expect(c.limits.maxChars).toBe(defaultConfig.limits.maxChars);
});
