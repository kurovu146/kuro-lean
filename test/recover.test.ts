import { test, expect } from "bun:test";
import { extractTail, latestTranscript } from "../src/recover";

const mk = (o: unknown) => JSON.stringify(o);

test("keeps human and model text, tagged with the role", () => {
  const out = extractTail([
    mk({ message: { role: "user", content: "fix the login bug" } }),
    mk({ message: { role: "assistant", content: [{ type: "text", text: "fixed in auth.ts:42" }] } }),
  ], 10);
  expect(out).toContain("fix the login bug");
  expect(out).toContain("auth.ts:42");
});

test("a long tool_result gets clipped — this is precisely what bloats a transcript", () => {
  const huge = "x".repeat(5000);
  const out = extractTail([
    mk({ message: { role: "user", content: [{ type: "tool_result", content: [{ type: "text", text: huge }] }] } }),
  ], 10);
  expect(out.length).toBeLessThan(1000);
  expect(out).toContain("result");
});

test("drops thinking (it can't be replayed and the next session doesn't need it)", () => {
  const out = extractTail([
    mk({ message: { role: "assistant", content: [
      { type: "thinking", thinking: "THIS IS THE THINKING" },
      { type: "text", text: "the conclusion" },
    ] } }),
  ], 10);
  expect(out).not.toContain("THIS IS THE THINKING");
  expect(out).toContain("the conclusion");
});

test("tool_use keeps the tool name + clipped input, so you know which file was touched", () => {
  const out = extractTail([
    mk({ message: { role: "assistant", content: [
      { type: "tool_use", name: "Edit", input: { file_path: "src/a.ts", new_string: "y".repeat(3000) } },
    ] } }),
  ], 10);
  expect(out).toContain("Edit");
  expect(out).toContain("src/a.ts");
  expect(out.length).toBeLessThan(600);
});

test("takes only the last N messages", () => {
  const lines = Array.from({ length: 50 }, (_, i) =>
    mk({ message: { role: "user", content: `message ${i}` } }));
  const out = extractTail(lines, 3);
  expect(out).toContain("message 49");
  expect(out).not.toContain("message 40");
});

test("a corrupt line is skipped without killing the whole extract", () => {
  const out = extractTail(["{corrupt", mk({ message: { role: "user", content: "still here" } })], 10);
  expect(out).toContain("still here");
});

test("nothing usable => empty string (the caller decides what to report)", () => {
  expect(extractTail(["{corrupt"], 10)).toBe("");
});

test("latestTranscript: missing directory => null, doesn't throw", () => {
  expect(latestTranscript("/no/such/directory/here")).toBeNull();
});
