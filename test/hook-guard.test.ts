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

test("find / without a scope => deny + a suggestion", () => {
  const r = decideGuard("find / -name foo", g);
  expect(r.deny).toBe(true);
  expect(r.reason).toContain("find");
});

test("the dependency-tree lister without a depth flag => deny", () => {
  expect(decideGuard("npm ls", g).deny).toBe(true);
});

test("tree without -L => deny", () => {
  expect(decideGuard("tree", g).deny).toBe(true);
  expect(decideGuard("cd src && tree", g).deny).toBe(true);
  expect(decideGuard("ls | tree", g).deny).toBe(true);
});

test("tree with -L => allow", () => {
  expect(decideGuard("tree -L 2", g).deny).toBe(false);
});

test('"tree" as an argument/string => allow (no false positive)', () => {
  expect(decideGuard('grep -rln "tree" src/', g).deny).toBe(false);
  expect(decideGuard("cat tree-sitter.json", g).deny).toBe(false);
  expect(decideGuard("echo subtree", g).deny).toBe(false);
});

test("a safe command => allow", () => {
  expect(decideGuard("ls -la", g).deny).toBe(false);
  expect(decideGuard("find ./src -name '*.ts'", g).deny).toBe(false);
});

test("catBig: cat on a big file => deny + a suggestion", () => {
  setupFiles();
  const r = decideGuard(`cat ${big}`, g);
  expect(r.deny).toBe(true);
  expect(r.reason).toContain("KB");
});

test("catBig: cat on a small or missing file => allow", () => {
  setupFiles();
  expect(decideGuard(`cat ${small}`, g).deny).toBe(false);
  expect(decideGuard(`cat ${DIR}/nope.txt`, g).deny).toBe(false);
});

test("catBig: head/tail on a big file is NOT blocked (they limit lines themselves)", () => {
  setupFiles();
  expect(decideGuard(`head -n 50 ${big}`, g).deny).toBe(false);
  expect(decideGuard(`tail ${big}`, g).deny).toBe(false);
});

test("gitLogP: the patch-printing log flags => deny (the full patch of every commit)", () => {
  const r = decideGuard("git log -p", g);
  expect(r.deny).toBe(true);
  expect(r.reason).toContain("git show");
  expect(decideGuard("git log --patch -5", g).deny).toBe(true);
  expect(decideGuard("git log -p -- src/a.ts", g).deny).toBe(true);
});

test("gitLogP: a plain log / the flag on another command => allow", () => {
  expect(decideGuard("git log --oneline -20", g).deny).toBe(false);
  expect(decideGuard("git log -5", g).deny).toBe(false);
  expect(decideGuard("grep -p foo src/", g).deny).toBe(false);
});

test("gitLogP: 'git log -p' nằm trong chuỗi (vd commit message) => allow", () => {
  expect(decideGuard('git commit -m "guard: chặn git log -p rất hay"', g).deny).toBe(false);
  expect(decideGuard("echo git log -p", g).deny).toBe(false);
});

test("gitLogP: git log -p sau && / | vẫn deny", () => {
  expect(decideGuard("cd src && git log -p", g).deny).toBe(true);
});

test("catBig tắt trong config => allow cat file lớn", () => {
  setupFiles();
  const off = { ...g, rules: { ...g.rules, catBig: false } };
  expect(decideGuard(`cat ${big}`, off).deny).toBe(false);
});
