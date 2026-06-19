import { test, expect } from "bun:test";
import { saveRun, showRun, listRuns } from "../src/store";
import { rmSync } from "fs";

const ROOT = "/tmp/kt-test-store";

test("save rồi show theo id", () => {
  rmSync(ROOT, { recursive: true, force: true });
  saveRun("001", "full log A", { root: ROOT });
  expect(showRun("001", ROOT)).toBe("full log A");
});

test("show không id => bản mới nhất; prune theo keep", () => {
  rmSync(ROOT, { recursive: true, force: true });
  saveRun("001", "A", { root: ROOT, keep: 2 });
  saveRun("002", "B", { root: ROOT, keep: 2 });
  saveRun("003", "C", { root: ROOT, keep: 2 });
  expect(showRun(undefined, ROOT)).toBe("C");
  expect(listRuns(ROOT)).toEqual(["002", "003"]);
});

test("trùng id => không ghi đè, tạo file hậu tố", () => {
  rmSync(ROOT, { recursive: true, force: true });
  saveRun("dup", "first", { root: ROOT });
  saveRun("dup", "second", { root: ROOT });
  expect(showRun("dup", ROOT)).toBe("first");        // bản gốc còn nguyên
  expect(showRun("dup-1", ROOT)).toBe("second");     // bản thứ 2 sang hậu tố
  expect(listRuns(ROOT)).toEqual(["dup", "dup-1"]);
});
