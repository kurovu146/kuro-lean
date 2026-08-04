import { test, expect } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { installSettings, installSkill, runDoctor } from "../src/init";

const DIR = "/tmp/kt-test-init";
const settings = `${DIR}/settings.json`;

test("empty settings => adds the hooks + statusLine", () => {
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

test("registers the Read matcher => kt hook-guard (blocks noisy files)", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(settings, "{}");
  installSettings(settings, "kt");
  const cfg = JSON.parse(readFileSync(settings, "utf8"));
  const readBlock = cfg.hooks.PreToolUse.find((m: any) => m.matcher === "Read");
  expect(readBlock).toBeDefined();
  expect(readBlock.hooks.map((h: any) => h.command)).toContain("kt hook-guard");
});

test("registers UserPromptSubmit => kt hook-prompt (blocks the first turn after the cache dies)", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(settings, "{}");
  installSettings(settings, "kt");
  const cfg = JSON.parse(readFileSync(settings, "utf8"));
  const cmds = cfg.hooks.UserPromptSubmit.flatMap((b: any) => b.hooks.map((h: any) => h.command));
  expect(cmds).toContain("kt hook-prompt");
  // a non-tool event => must carry no matcher; Claude Code only accepts matchers for tool events
  expect(cfg.hooks.UserPromptSubmit[0].matcher).toBeUndefined();
});

test("UserPromptSubmit: a second run does not duplicate it, the user's existing hooks survive", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(settings, JSON.stringify({
    hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "my-prompt-hook" }] }] },
  }));
  installSettings(settings, "kt");
  installSettings(settings, "kt");
  const cfg = JSON.parse(readFileSync(settings, "utf8"));
  const cmds = cfg.hooks.UserPromptSubmit.flatMap((b: any) => b.hooks.map((h: any) => h.command));
  expect(cmds).toContain("my-prompt-hook");
  expect(cmds.filter((c: string) => c === "kt hook-prompt").length).toBe(1);
});

test("doctor: reports the hook-prompt status", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(`${DIR}/.claude`, { recursive: true });
  writeFileSync(`${DIR}/.claude/settings.json`, "{}");
  installSettings(`${DIR}/.claude/settings.json`, "kt");
  expect(runDoctor(DIR)).toContain("hook-prompt:  ✓");
});

test("an existing custom statusLine => NOT overwritten, hooks still added", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  const custom = "node \"$HOME/.claude/statusline.cjs\"";
  writeFileSync(settings, JSON.stringify({ statusLine: { type: "command", command: custom, padding: 0 } }));
  installSettings(settings, "kt");
  const cfg = JSON.parse(readFileSync(settings, "utf8"));
  expect(cfg.statusLine.command).toBe(custom); // the custom statusline is left alone
  const hooks = cfg.hooks.PreToolUse[0].hooks.map((h: any) => h.command);
  expect(hooks).toContain("kt hook-guard");
  expect(hooks).toContain("kt hook-compress");
});

test("idempotent: a second run does not duplicate anything", () => {
  installSettings(settings, "kt");
  const before = readFileSync(settings, "utf8");
  const r = installSettings(settings, "kt");
  expect(r.changed).toBe(false);
  expect(readFileSync(settings, "utf8")).toBe(before);
});

test("leaves the user's existing hooks/config intact", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(settings, JSON.stringify({ env: { FOO: "bar" }, hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "my-hook" }] }] } }));
  installSettings(settings, "kt");
  const cfg = JSON.parse(readFileSync(settings, "utf8"));
  expect(cfg.env.FOO).toBe("bar");
  expect(JSON.stringify(cfg.hooks.PreToolUse)).toContain("my-hook");
  expect(existsSync(`${settings}.bak`)).toBe(true);
});

test("adds Bash(kt run:*) to permissions.allow, keeping the existing entries", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(settings, JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] } }));
  installSettings(settings, "kt");
  const cfg = JSON.parse(readFileSync(settings, "utf8"));
  expect(cfg.permissions.allow).toContain("Bash(kt run:*)");
  expect(cfg.permissions.allow).toContain("Bash(ls:*)");
  // idempotent: re-running does not duplicate
  installSettings(settings, "kt");
  const again = JSON.parse(readFileSync(settings, "utf8"));
  expect(again.permissions.allow.filter((p: string) => p === "Bash(kt run:*)").length).toBe(1);
});

test("installSkill: copies to <skills>/concise-output/SKILL.md, idempotent", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  const skillsDir = `${DIR}/skills`;
  const r1 = installSkill(skillsDir, "skills/concise-output.md");
  expect(r1.changed).toBe(true);
  expect(readFileSync(`${skillsDir}/concise-output/SKILL.md`, "utf8")).toContain("concise-output");
  const r2 = installSkill(skillsDir, "skills/concise-output.md");
  expect(r2.changed).toBe(false);
});

test("installSkill: the user already has the skill (custom or not) => NOT overwritten", () => {
  rmSync(DIR, { recursive: true, force: true });
  const skillsDir = `${DIR}/skills`;
  mkdirSync(`${skillsDir}/concise-output`, { recursive: true });
  writeFileSync(`${skillsDir}/concise-output/SKILL.md`, "the user's own version");
  const r = installSkill(skillsDir, "skills/concise-output.md");
  expect(r.changed).toBe(false);
  expect(readFileSync(`${skillsDir}/concise-output/SKILL.md`, "utf8")).toBe("the user's own version");
});

test("runDoctor: reports the kt run permission + the concise-output skill", () => {
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

test("runDoctor: a statusLine that is a wrapper script calling kt status inside => OK", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(`${DIR}/.claude`, { recursive: true });
  mkdirSync(`${DIR}/scripts`, { recursive: true });
  // like a real statusline.sh: kt lives in a variable, invoked as "$KT" status
  writeFileSync(
    `${DIR}/scripts/statusline.sh`,
    'KT="/Users/x/.bun/bin/kt"\nbase=$(printf \'%s\' "$input" | "$KT" status 2>/dev/null)\n',
  );
  writeFileSync(
    `${DIR}/.claude/settings.json`,
    JSON.stringify({ statusLine: { type: "command", command: "bash ~/scripts/statusline.sh" } }),
  );
  const out = runDoctor(DIR);
  expect(out).toMatch(/statusLine kt:\s+✓/);
});

test("a corrupt settings.json => installSettings errors clearly and does NOT overwrite", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(settings, "{ not json");
  expect(() => installSettings(settings, "kt")).toThrow(/is not valid JSON/);
  expect(readFileSync(settings, "utf8")).toBe("{ not json"); // the file is untouched
});

test("runDoctor: a corrupt settings.json => warns without crashing", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(`${DIR}/.claude`, { recursive: true });
  writeFileSync(`${DIR}/.claude/settings.json`, "{ broken");
  const out = runDoctor(DIR);
  expect(out).toContain("is not valid JSON");
});

test("appends to an existing Bash matcher without creating a duplicate block", () => {
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

test("installSkill: derives the skill name from the source filename (lean-code)", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  const skillsDir = `${DIR}/skills`;
  const r1 = installSkill(skillsDir, "skills/lean-code.md");
  expect(r1.changed).toBe(true);
  expect(readFileSync(`${skillsDir}/lean-code/SKILL.md`, "utf8")).toContain("lean-code");
  const r2 = installSkill(skillsDir, "skills/lean-code.md");
  expect(r2.changed).toBe(false);
});

test("installSkill: the user already has a custom lean-code => NOT overwritten", () => {
  rmSync(DIR, { recursive: true, force: true });
  const skillsDir = `${DIR}/skills`;
  mkdirSync(`${skillsDir}/lean-code`, { recursive: true });
  writeFileSync(`${skillsDir}/lean-code/SKILL.md`, "the user's own version");
  const r = installSkill(skillsDir, "skills/lean-code.md");
  expect(r.changed).toBe(false);
  expect(readFileSync(`${skillsDir}/lean-code/SKILL.md`, "utf8")).toBe("the user's own version");
});

test("runDoctor: reports the lean-code skill status too", () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(`${DIR}/.claude/skills/lean-code`, { recursive: true });
  writeFileSync(`${DIR}/.claude/skills/lean-code/SKILL.md`, "x");
  const out = runDoctor(DIR);
  expect(out).toMatch(/skill lean-code:\s+✓/);
  expect(out).toMatch(/skill concise-output:\s+✗/);
});
