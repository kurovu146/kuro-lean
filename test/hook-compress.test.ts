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
