import { test, expect } from "bun:test";
import { decideCompress } from "../src/hooks/compress";

test("lệnh test => rewrite sang kt run", () => {
  expect(decideCompress("npm test")).toBe("kt run -- npm test");
});

test("đã là kt => bỏ qua", () => {
  expect(decideCompress("kt run -- npm test")).toBeNull();
});

test("có pipe/redirect/&& => bỏ qua (tránh phá logic)", () => {
  expect(decideCompress("npm test | tee out.txt")).toBeNull();
  expect(decideCompress("npm test && echo ok")).toBeNull();
  expect(decideCompress("npm test > out.txt")).toBeNull();
});

test("generic không match => null", () => {
  expect(decideCompress("echo hi")).toBeNull();
});

test("KT_DISABLE=1 => null (kill-switch)", () => {
  process.env.KT_DISABLE = "1";
  try {
    expect(decideCompress("npm test")).toBeNull();
  } finally {
    delete process.env.KT_DISABLE;
  }
});

test("env-prefix => null (spawn array sẽ coi FOO=1 là binary)", () => {
  expect(decideCompress("GIT_PAGER=cat git diff")).toBeNull();
  expect(decideCompress("CI=1 npm test")).toBeNull();
});

test("có `kt run` ở giữa (bypass thủ công) => null, tránh double-wrap", () => {
  expect(decideCompress("KT_RAW=1 kt run -- git diff")).toBeNull();
});

test("lệnh watch/long-running => null (wrap sẽ treo)", () => {
  expect(decideCompress("tsc --watch")).toBeNull();
  expect(decideCompress("jest --watch")).toBeNull();
  expect(decideCompress("vitest watch")).toBeNull();
  expect(decideCompress("next build -w")).toBeNull();
});

test("yarn dev => null (không còn nhận nhầm install)", () => {
  expect(decideCompress("yarn dev")).toBeNull();
  expect(decideCompress("yarn start")).toBeNull();
});

test("newline trong lệnh => null", () => {
  expect(decideCompress("npm test\necho hi")).toBeNull();
});
