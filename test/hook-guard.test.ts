import { test, expect } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { decideGuard } from "../src/hooks/guard";
import { defaultConfig } from "../src/config";

const g = defaultConfig.guard;

const DIR = "/tmp/kt-test-guard";
const big = `${DIR}/big.txt`;
const small = `${DIR}/small.txt`;
function setupFiles() {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(big, "x".repeat(200 * 1024)); // 200KB > maxCatKb 100
  writeFileSync(small, "x".repeat(1024)); // 1KB
}

test("find / không scope => deny + gợi ý", () => {
  const r = decideGuard("find / -name foo", g);
  expect(r.deny).toBe(true);
  expect(r.reason).toContain("find");
});

test("npm ls không depth => deny", () => {
  expect(decideGuard("npm ls", g).deny).toBe(true);
});

test("tree không -L => deny", () => {
  expect(decideGuard("tree", g).deny).toBe(true);
  expect(decideGuard("cd src && tree", g).deny).toBe(true);
  expect(decideGuard("ls | tree", g).deny).toBe(true);
});

test("tree có -L => allow", () => {
  expect(decideGuard("tree -L 2", g).deny).toBe(false);
});

test('"tree" là đối số/chuỗi => allow (không false-positive)', () => {
  expect(decideGuard('grep -rln "tree" src/', g).deny).toBe(false);
  expect(decideGuard("cat tree-sitter.json", g).deny).toBe(false);
  expect(decideGuard("echo subtree", g).deny).toBe(false);
});

test("lệnh an toàn => allow", () => {
  expect(decideGuard("ls -la", g).deny).toBe(false);
  expect(decideGuard("find ./src -name '*.ts'", g).deny).toBe(false);
});

test("catBig: cat file lớn => deny + gợi ý", () => {
  setupFiles();
  const r = decideGuard(`cat ${big}`, g);
  expect(r.deny).toBe(true);
  expect(r.reason).toContain("KB");
});

test("catBig: cat file nhỏ / file không tồn tại => allow", () => {
  setupFiles();
  expect(decideGuard(`cat ${small}`, g).deny).toBe(false);
  expect(decideGuard(`cat ${DIR}/nope.txt`, g).deny).toBe(false);
});

test("catBig: head/tail file lớn KHÔNG bị chặn (tự giới hạn dòng)", () => {
  setupFiles();
  expect(decideGuard(`head -n 50 ${big}`, g).deny).toBe(false);
  expect(decideGuard(`tail ${big}`, g).deny).toBe(false);
});

test("catBig tắt trong config => allow cat file lớn", () => {
  setupFiles();
  const off = { ...g, rules: { ...g.rules, catBig: false } };
  expect(decideGuard(`cat ${big}`, off).deny).toBe(false);
});
