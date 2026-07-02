import { test, expect } from "bun:test";
import { detect, type Profile } from "../src/detect";

test.each([
  ["npm test", "test"],
  ["pnpm run test", "test"],
  ["vitest run", "test"],
  ["go test ./...", "test"],
  ["bun run test", "test"],
  ["cargo build --release", "build"],
  ["tsc -p .", "build"],
  ["next build", "build"],
  // package-manager script (dạng phổ biến nhất trong thực tế) phải được nhận diện
  ["npm run build", "build"],
  ["pnpm build", "build"],
  ["yarn build", "build"],
  ["bun run build", "build"],
  // linter: output error/warning noisy → profile lint (nén kiểu build)
  ["eslint .", "lint"],
  ["npx eslint src --max-warnings 0", "lint"],
  ["golangci-lint run", "lint"],
  ["yarn lint", "lint"],
  ["bun run lint", "lint"],
  ["npm install", "install"],
  ["pnpm add zod", "install"],
  ["bun install", "install"],
  ["yarn add zod", "install"],
  ["yarn install", "install"],
  // yarn <khác> KHÔNG được nhận nhầm là install (tránh wrap dev server → treo)
  ["yarn dev", "generic"],
  ["yarn start", "generic"],
  ["git status", "git"],
  ["git diff HEAD~1", "git"],
  ["ls -la", "generic"],
  ["echo hi", "generic"],
])("detect(%s) => %s", (cmd, expected) => {
  expect(detect(cmd as string)).toBe(expected as Profile);
});
