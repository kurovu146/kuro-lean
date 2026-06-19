import { test, expect } from "bun:test";
import { decideGuard } from "../src/hooks/guard";
import { defaultConfig } from "../src/config";

const g = defaultConfig.guard;

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
});

test("lệnh an toàn => allow", () => {
  expect(decideGuard("ls -la", g).deny).toBe(false);
  expect(decideGuard("find ./src -name '*.ts'", g).deny).toBe(false);
});
