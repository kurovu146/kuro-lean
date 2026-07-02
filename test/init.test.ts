import { test, expect } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { installSettings, installSkill, runDoctor } from "../src/init";

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

test("đăng ký matcher Read => kt hook-guard (chặn file nhiễu)", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(settings, "{}");
  installSettings(settings, "kt");
  const cfg = JSON.parse(readFileSync(settings, "utf8"));
  const readBlock = cfg.hooks.PreToolUse.find((m: any) => m.matcher === "Read");
  expect(readBlock).toBeDefined();
  expect(readBlock.hooks.map((h: any) => h.command)).toContain("kt hook-guard");
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

test("thêm Bash(kt run:*) vào permissions.allow, giữ allow có sẵn", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(settings, JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] } }));
  installSettings(settings, "kt");
  const cfg = JSON.parse(readFileSync(settings, "utf8"));
  expect(cfg.permissions.allow).toContain("Bash(kt run:*)");
  expect(cfg.permissions.allow).toContain("Bash(ls:*)");
  // idempotent: chạy lại không nhân đôi
  installSettings(settings, "kt");
  const again = JSON.parse(readFileSync(settings, "utf8"));
  expect(again.permissions.allow.filter((p: string) => p === "Bash(kt run:*)").length).toBe(1);
});

test("installSkill: copy vào <skills>/concise-output/SKILL.md, idempotent", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  const skillsDir = `${DIR}/skills`;
  const r1 = installSkill(skillsDir, "skills/concise-output.md");
  expect(r1.changed).toBe(true);
  expect(readFileSync(`${skillsDir}/concise-output/SKILL.md`, "utf8")).toContain("concise-output");
  const r2 = installSkill(skillsDir, "skills/concise-output.md");
  expect(r2.changed).toBe(false);
});

test("installSkill: user đã có skill (kể cả custom) => KHÔNG ghi đè", () => {
  rmSync(DIR, { recursive: true, force: true });
  const skillsDir = `${DIR}/skills`;
  mkdirSync(`${skillsDir}/concise-output`, { recursive: true });
  writeFileSync(`${skillsDir}/concise-output/SKILL.md`, "custom của anh");
  const r = installSkill(skillsDir, "skills/concise-output.md");
  expect(r.changed).toBe(false);
  expect(readFileSync(`${skillsDir}/concise-output/SKILL.md`, "utf8")).toBe("custom của anh");
});

test("runDoctor: báo trạng thái permission kt run + skill concise-output", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(`${DIR}/.claude/skills/concise-output`, { recursive: true });
  writeFileSync(
    `${DIR}/.claude/settings.json`,
    JSON.stringify({ permissions: { allow: ["Bash(kt run:*)"] } }),
  );
  writeFileSync(`${DIR}/.claude/skills/concise-output/SKILL.md`, "x");
  const out = runDoctor(DIR);
  expect(out).toMatch(/permission kt run:\s+✓/);
  expect(out).toMatch(/skill concise-output:\s+✓/);
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
