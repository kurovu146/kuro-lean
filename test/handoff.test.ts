import { test, expect } from "bun:test";
import { handoffPrompt } from "../src/handoff";

test("handoffPrompt lays out enough structure for a new session to continue without the history", () => {
  const p = handoffPrompt(".kt/handoff.md");
  for (const section of ["In progress", "Done", "Decisions", "Next step", "Files", "Traps"]) {
    expect(p).toContain(section);
  }
});

test("handoffPrompt embeds the exact file path it was given", () => {
  expect(handoffPrompt("docs/state.md")).toContain("docs/state.md");
});

test("handoffPrompt forbids copying code back in — that's what bloats the file for nothing", () => {
  expect(handoffPrompt(".kt/handoff.md").toLowerCase()).toContain("do not copy code");
});
