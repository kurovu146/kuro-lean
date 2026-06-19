import { test, expect } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { installSettings } from "../src/init";

const DIR = "/tmp/kt-test-init";
const settings = `${DIR}/settings.json`;

test("settings trống => thêm hook + statusLine", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(settings, "{}");
  const r = installSettings(settings, "kt");
  expect(r.changed).toBe(true);
  const cfg = JSON.parse(readFileSync(settings, "utf8"));
  expect(cfg.statusLine.command).toContain("kt status");
  const hooks = cfg.hooks.PreToolUse[0].hooks.map((h: any) => h.command);
  expect(hooks).toContain("kt hook-guard");
  expect(hooks).toContain("kt hook-compress");
});

test("idempotent: chạy lần 2 không nhân đôi", () => {
  installSettings(settings, "kt");
  const before = readFileSync(settings, "utf8");
  const r = installSettings(settings, "kt");
  expect(r.changed).toBe(false);
  expect(readFileSync(settings, "utf8")).toBe(before);
});

test("giữ nguyên hook/config có sẵn của user", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(settings, JSON.stringify({ env: { FOO: "bar" }, hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "my-hook" }] }] } }));
  installSettings(settings, "kt");
  const cfg = JSON.parse(readFileSync(settings, "utf8"));
  expect(cfg.env.FOO).toBe("bar");
  expect(JSON.stringify(cfg.hooks.PreToolUse)).toContain("my-hook");
  expect(existsSync(`${settings}.bak`)).toBe(true);
});

test("append vào Bash matcher có sẵn, không tạo block trùng", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(settings, JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "user-bash-hook" }] }] } }));
  installSettings(settings, "kt");
  const cfg = JSON.parse(readFileSync(settings, "utf8"));
  const bashBlocks = cfg.hooks.PreToolUse.filter((m: any) => m.matcher === "Bash");
  expect(bashBlocks.length).toBe(1);
  const cmds = bashBlocks[0].hooks.map((h: any) => h.command);
  expect(cmds).toContain("user-bash-hook");
  expect(cmds).toContain("kt hook-guard");
  expect(cmds).toContain("kt hook-compress");
});
