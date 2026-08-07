import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { lastActivityIn, lastActivity, idleMinutes } from "../src/transcript";

const tmp = () => mkdtempSync(join(tmpdir(), "kt-transcript-"));
const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();

/** Write a transcript, then set its mtime to `mtimeMinAgo` — the two clocks can disagree, which is the point. */
function fakeTranscript(entries: object[], mtimeMinAgo: number): string {
  const f = join(tmp(), "session.jsonl");
  writeFileSync(f, entries.map((e) => JSON.stringify(e)).join("\n"));
  const t = new Date(Date.now() - mtimeMinAgo * 60_000);
  utimesSync(f, t, t);
  return f;
}

test("takes the newest user/assistant timestamp, reading from the tail", () => {
  const ms = lastActivityIn([
    JSON.stringify({ type: "user", timestamp: at(300) }),
    JSON.stringify({ type: "assistant", timestamp: at(240) }),
  ]);
  expect(Math.round((Date.now() - ms) / 60_000)).toBe(240);
});

test("bookkeeping entries are NOT activity — this is the whole bug", () => {
  // Claude Code appends these while the panel sits untouched; they must not reset the clock.
  const ms = lastActivityIn([
    JSON.stringify({ type: "assistant", timestamp: at(220) }),
    JSON.stringify({ type: "file-history-snapshot" }),
    JSON.stringify({ type: "file-history-delta", timestamp: at(22) }),
    JSON.stringify({ type: "ai-title", timestamp: at(22) }),
    JSON.stringify({ type: "mode", timestamp: at(22) }),
  ]);
  expect(Math.round((Date.now() - ms) / 60_000)).toBe(220);
});

test("a fresh mtime does NOT hide an old conversation: 4h idle reports 4h, not 22m", () => {
  // The real 2026-08-05 case: bookkeeping wrote at minute 22, the human had been gone 3h38m.
  const f = fakeTranscript(
    [
      { type: "user", timestamp: at(218) },
      { type: "assistant", timestamp: at(218) },
      { type: "file-history-snapshot" },
    ],
    22, // mtime says 22 minutes — the number kt used to print
  );
  expect(Math.round(idleMinutes(f))).toBe(218);
});

test("no conversation entry in the tail => fall back to mtime, never invent a number", () => {
  const f = fakeTranscript([{ type: "file-history-snapshot" }], 90);
  expect(lastActivity(f)).toBe(0);
  expect(Math.round(idleMinutes(f))).toBe(90);
});

test("a half-line at the start of the slice is skipped, not thrown on", () => {
  const ms = lastActivityIn([
    '{"type":"assistant","timesta', // the 64KB slice cut this one in half
    JSON.stringify({ type: "user", timestamp: at(45) }),
  ]);
  expect(Math.round((Date.now() - ms) / 60_000)).toBe(45);
});

test("an entry without a parsable timestamp is skipped, not counted as now", () => {
  const ms = lastActivityIn([
    JSON.stringify({ type: "user", timestamp: at(70) }),
    JSON.stringify({ type: "assistant", timestamp: "not-a-date" }),
  ]);
  expect(Math.round((Date.now() - ms) / 60_000)).toBe(70);
});

test("unreadable file => 0 idle, so a caller never blocks on a guess", () => {
  expect(idleMinutes(join(tmp(), "does-not-exist.jsonl"))).toBe(0);
});
