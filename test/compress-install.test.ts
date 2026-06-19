import { test, expect } from "bun:test";
import { compressInstall } from "../src/compressors/install";
import type { CompressInput } from "../src/compressors/types";

test("install fail => GIỮ toàn bộ body lỗi", () => {
  const input: CompressInput = {
    stdout: [
      "npm ERR! code E404",
      "npm ERR! 404 Not Found - GET https://registry.npmjs.org/nope",
      "npm ERR! 404 'nope@*' is not in this registry.",
    ].join("\n"),
    stderr: "", exitCode: 1, command: "npm install nope",
  };
  const r = compressInstall(input);
  expect(r.text).toContain("npm ERR! code E404");
  expect(r.text).toContain("not in this registry");
});

test("giữ dòng kết quả + warn, bỏ progress", () => {
  const input: CompressInput = {
    stdout: [
      "Resolving dependencies",
      "Fetching package a",
      "Fetching package b",
      "npm warn deprecated foo@1.0.0",
      "added 120 packages in 4s",
    ].join("\n"),
    stderr: "", exitCode: 0, command: "npm install",
  };
  const r = compressInstall(input);
  expect(r.text).toContain("added 120 packages");
  expect(r.text).toContain("deprecated foo");
  expect(r.text).not.toContain("Fetching package");
});
