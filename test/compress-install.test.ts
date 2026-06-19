import { test, expect } from "bun:test";
import { compressInstall } from "../src/compressors/install";
import type { CompressInput } from "../src/compressors/types";

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
