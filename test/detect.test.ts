import { test, expect } from "bun:test";
import { detect } from "../src/detect";

test.each([
  ["npm test", "test"],
  ["pnpm run test", "test"],
  ["vitest run", "test"],
  ["go test ./...", "test"],
  ["cargo build --release", "build"],
  ["tsc -p .", "build"],
  ["next build", "build"],
  ["npm install", "install"],
  ["pnpm add zod", "install"],
  ["bun install", "install"],
  ["git status", "git"],
  ["git diff HEAD~1", "git"],
  ["ls -la", "generic"],
  ["echo hi", "generic"],
])("detect(%s) => %s", (cmd, expected) => {
  expect(detect(cmd as string)).toBe(expected);
});
