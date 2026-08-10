import { test, expect } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { checkNoisyRead } from "../src/hooks/guard";
import { defaultConfig } from "../src/config";

const CFG = defaultConfig.guard;

test.each([
  ["/proj/package-lock.json", "lock npm"],
  ["/proj/yarn.lock", "lock yarn"],
  ["/proj/pnpm-lock.yaml", "lock pnpm"],
  ["/proj/bun.lockb", "lock bun"],
  ["/proj/go.sum", "go.sum"],
  ["/proj/Cargo.lock", "lock cargo"],
  ["/proj/app.min.js", "minified js"],
  ["/proj/style.min.css", "minified css"],
  ["/proj/bundle.js.map", "source map"],
  ["/proj/node_modules/lib/index.js", "node_modules"],
  ["/proj/dist/main.js", "dist"],
  ["/proj/.next/server/page.js", ".next"],
])("deny noise file: %s", (file_path) => {
  expect(checkNoisyRead({ file_path }, CFG)).not.toBeNull();
});

test.each([
  ["/proj/src/index.ts"],
  ["/proj/README.md"],
  ["/proj/src/components/Button.tsx"],
])("allows an ordinary code file: %s", (file_path) => {
  expect(checkNoisyRead({ file_path }, CFG)).toBeNull();
});

test("escape hatch: an offset => allow reading a slice of a lock file", () => {
  expect(checkNoisyRead({ file_path: "/proj/package-lock.json", offset: 100 }, CFG)).toBeNull();
});

test("escape hatch: a small limit (<=400) => allow", () => {
  expect(checkNoisyRead({ file_path: "/proj/yarn.lock", limit: 50 }, CFG)).toBeNull();
});

test("a LARGE limit (>400) is not an escape hatch => still deny", () => {
  expect(checkNoisyRead({ file_path: "/proj/yarn.lock", limit: 1000 }, CFG)).not.toBeNull();
});

test("rule disabled (readNoise=false) => null", () => {
  const off = { ...CFG, rules: { ...CFG.rules, readNoise: false } };
  expect(checkNoisyRead({ file_path: "/proj/package-lock.json" }, off)).toBeNull();
});

test("missing file_path => null (no crash)", () => {
  expect(checkNoisyRead({}, CFG)).toBeNull();
});

test("a large file (> maxReadKb) even without a pattern match => deny", () => {
  const dir = "/tmp/kt-test-guard-read";
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const big = `${dir}/data.json`;
  writeFileSync(big, "x".repeat(CFG.maxReadKb * 1024 + 10));
  expect(checkNoisyRead({ file_path: big }, CFG)).not.toBeNull();
});
