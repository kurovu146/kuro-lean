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
])("deny file nhiễu: %s", (file_path) => {
  expect(checkNoisyRead({ file_path }, CFG)).not.toBeNull();
});

test.each([
  ["/proj/src/index.ts"],
  ["/proj/README.md"],
  ["/proj/src/components/Button.tsx"],
])("cho qua file code thường: %s", (file_path) => {
  expect(checkNoisyRead({ file_path }, CFG)).toBeNull();
});

test("cửa thoát: có offset => cho đọc đoạn lock file", () => {
  expect(checkNoisyRead({ file_path: "/proj/package-lock.json", offset: 100 }, CFG)).toBeNull();
});

test("cửa thoát: limit nhỏ (≤400) => cho qua", () => {
  expect(checkNoisyRead({ file_path: "/proj/yarn.lock", limit: 50 }, CFG)).toBeNull();
});

test("limit LỚN (>400) không phải cửa thoát => vẫn deny", () => {
  expect(checkNoisyRead({ file_path: "/proj/yarn.lock", limit: 1000 }, CFG)).not.toBeNull();
});

test("rule tắt (readNoise=false) => null", () => {
  const off = { ...CFG, rules: { ...CFG.rules, readNoise: false } };
  expect(checkNoisyRead({ file_path: "/proj/package-lock.json" }, off)).toBeNull();
});

test("thiếu file_path => null (không crash)", () => {
  expect(checkNoisyRead({}, CFG)).toBeNull();
});

test("file lớn (> maxReadKb) dù không khớp pattern => deny", () => {
  const dir = "/tmp/kt-test-guard-read";
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const big = `${dir}/data.json`;
  writeFileSync(big, "x".repeat(CFG.maxReadKb * 1024 + 10));
  expect(checkNoisyRead({ file_path: big }, CFG)).not.toBeNull();
});
