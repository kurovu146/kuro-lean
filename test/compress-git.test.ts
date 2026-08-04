import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { compressGit } from "../src/compressors/git";
import type { CompressInput } from "../src/compressors/types";

test("git diff LỚN => per-file +/- stat", () => {
  const input: CompressInput = {
    stdout: readFileSync("test/fixtures/git-diff.txt", "utf8"),
    stderr: "", exitCode: 0, command: "git diff",
  };
  // force a low threshold to reach the summarising branch (the fixture is small)
  const r = compressGit(input, { thresholdLines: 5, headLines: 15, tailLines: 10 });
  expect(r.text).toContain("src/a.ts");
  expect(r.text).toContain("+1 -1");   // a.ts: 1 add, 1 remove
  expect(r.text).toContain("src/b.ts");
  expect(r.text).not.toContain("@@");  // hunk headers are dropped
});

test("a SMALL git diff => keep the content verbatim (Claude needs to read it)", () => {
  const input: CompressInput = {
    stdout: readFileSync("test/fixtures/git-diff.txt", "utf8"),
    stderr: "", exitCode: 0, command: "git diff",
  };
  const r = compressGit(input); // default threshold 40 > 16 lines
  expect(r.text).toContain("@@");        // giữ hunk
  expect(r.text).toContain("+const y = 2;");
});

test("small git status => untouched (generic)", () => {
  const input: CompressInput = {
    stdout: "On branch main\nnothing to commit, working tree clean",
    stderr: "", exitCode: 0, command: "git status",
  };
  const r = compressGit(input);
  expect(r.text).toContain("working tree clean");
});
