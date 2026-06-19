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
  ["yarn add zod", "install"],
  ["yarn install", "install"],
  // yarn <khác> KHÔNG được nhận nhầm là install (tránh wrap dev server → treo)
  ["yarn dev", "generic"],
  ["yarn start", "generic"],
  ["yarn lint", "generic"],
  ["yarn build", "generic"],
  ["git status", "git"],
  ["git diff HEAD~1", "git"],
  ["ls -la", "generic"],
  ["echo hi", "generic"],
])("detect(%s) => %s", (cmd, expected) => {
  expect(detect(cmd as string)).toBe(expected);
});
