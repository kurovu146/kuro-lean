import { test, expect } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { installSettings, runDoctor } from "../src/init";

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

test("có statusLine custom sẵn => KHÔNG ghi đè, vẫn thêm hook", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  const custom = "node \"$HOME/.claude/statusline.cjs\"";
  writeFileSync(settings, JSON.stringify({ statusLine: { type: "command", command: custom, padding: 0 } }));
  installSettings(settings, "kt");
  const cfg = JSON.parse(readFileSync(settings, "utf8"));
  expect(cfg.statusLine.command).toBe(custom); // giữ nguyên statusline custom
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

test("settings.json hỏng => installSettings báo lỗi rõ, KHÔNG ghi đè", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(settings, "{ not json");
  expect(() => installSettings(settings, "kt")).toThrow(/không phải JSON hợp lệ/);
  expect(readFileSync(settings, "utf8")).toBe("{ not json"); // file nguyên vẹn
});

test("runDoctor: settings.json hỏng => cảnh báo, không crash", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(`${DIR}/.claude`, { recursive: true });
  writeFileSync(`${DIR}/.claude/settings.json`, "{ broken");
  const out = runDoctor(DIR);
  expect(out).toContain("không phải JSON hợp lệ");
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
