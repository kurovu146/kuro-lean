import { test, expect } from "bun:test";
import { saveRun, showRun, listRuns } from "../src/store";
import { rmSync } from "fs";

const ROOT = "/tmp/kt-test-store";

test("save then show by id", () => {
  rmSync(ROOT, { recursive: true, force: true });
  saveRun("001", "full log A", { root: ROOT });
  expect(showRun("001", ROOT)).toBe("full log A");
});

test("show without an id => the newest run; prune honours keep", () => {
  rmSync(ROOT, { recursive: true, force: true });
  saveRun("001", "A", { root: ROOT, keep: 2 });
  saveRun("002", "B", { root: ROOT, keep: 2 });
  saveRun("003", "C", { root: ROOT, keep: 2 });
  expect(showRun(undefined, ROOT)).toBe("C");
  expect(listRuns(ROOT)).toEqual(["002", "003"]);
});

test("a duplicate id => no overwrite, a suffixed file is created", () => {
  rmSync(ROOT, { recursive: true, force: true });
  saveRun("dup", "first", { root: ROOT });
  saveRun("dup", "second", { root: ROOT });
  expect(showRun("dup", ROOT)).toBe("first");        // the original is intact
  expect(showRun("dup-1", ROOT)).toBe("second");     // the second went to a suffix
  expect(listRuns(ROOT)).toEqual(["dup", "dup-1"]);
});
