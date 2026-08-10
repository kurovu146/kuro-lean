import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, statSync } from "fs";
import { homedir } from "os";
import { join, dirname, basename } from "path";

// Matches both direct invocation (`kt status`, `/path/to/kt status`) and via a variable (`"$KT" status`).
const KT_STATUS_RE = /(kt|\$\{?KT\}?)["']?\s+status\b/;

/**
 * Does the statusLine use kt? Many users wrap `kt status` in their own script
 * (e.g. `bash ~/.claude/scripts/statusline.sh` appending usage) -> read the contents of the
 * referenced file rather than only string-matching settings.json.
 */
function statusLineUsesKt(command: string, home: string): boolean {
  if (KT_STATUS_RE.test(command)) return true;
  for (const raw of command.split(/\s+/)) {
    const tok = raw.replace(/^["']|["']$/g, "");
    const p = tok.startsWith("~/") ? join(home, tok.slice(2)) : tok;
    try {
      if (existsSync(p) && statSync(p).isFile() && KT_STATUS_RE.test(readFileSync(p, "utf8"))) return true;
    } catch {
      // unreadable -> treat it as not a wrapper
    }
  }
  return false;
}

interface HookEntry { type: "command"; command: string }
interface Matcher { matcher: string; hooks: HookEntry[] }

/** Ensure the matcher exists and holds every command (idempotent, never creates a duplicate block). */
function ensureMatcher(list: Matcher[], matcher: string, cmds: string[]): void {
  let block = list.find((m) => m.matcher === matcher);
  if (!block) {
    block = { matcher, hooks: [] };
    list.push(block);
  }
  block.hooks ??= [];
  for (const cmd of cmds) {
    if (!block.hooks.some((h) => h.command === cmd)) {
      block.hooks.push({ type: "command", command: cmd });
    }
  }
}

/**
 * Like ensureMatcher but for events NOT tied to a tool (UserPromptSubmit, SessionEnd...):
 * these events have no matcher, and attaching one only causes confusion.
 */
function ensureHook(list: { hooks: HookEntry[] }[], cmd: string): void {
  if (list.some((b) => b.hooks?.some((h) => h.command === cmd))) return;
  const plain = list.find((b) => !("matcher" in b));
  if (plain) plain.hooks.push({ type: "command", command: cmd });
  else list.push({ hooks: [{ type: "command", command: cmd }] });
}

function parseSettings(settingsPath: string): any {
  if (!existsSync(settingsPath)) return {};
  const raw = readFileSync(settingsPath, "utf8") || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${settingsPath} is not valid JSON - fix it by hand and re-run (left untouched so nothing is lost).`);
  }
}

export function installSettings(settingsPath: string, ktBin: string): { changed: boolean; backup?: string } {
  const settings: any = parseSettings(settingsPath);

  const before = JSON.stringify(settings);

  // statusLine: only set when the user has NO statusLine yet.
  // NEVER overwrite a custom statusLine (e.g. their own statusline.cjs).
  const wantStatus = `${ktBin} status`;
  if (!settings.statusLine) {
    settings.statusLine = { type: "command", command: wantStatus, padding: 2 };
  }

  // hooks.PreToolUse: Bash (guard first, compress after) + Read (the guard blocks noisy files)
  settings.hooks ??= {};
  settings.hooks.PreToolUse ??= [];
  ensureMatcher(settings.hooks.PreToolUse, "Bash", [`${ktBin} hook-guard`, `${ktBin} hook-compress`]);
  ensureMatcher(settings.hooks.PreToolUse, "Read", [`${ktBin} hook-guard`]);

  // hooks.UserPromptSubmit: block the first turn after the cache dies. It must be a BEFORE-send hook;
  // the status line redraws after the request has left, so it can only show the bill, never prevent it.
  settings.hooks.UserPromptSubmit ??= [];
  ensureHook(settings.hooks.UserPromptSubmit, `${ktBin} hook-prompt`);

  // permissions.allow: after rewriting, the command is `kt run -- ...`, so an old allowlist entry
  // no longer matches -> add it automatically so the user is not re-prompted after every wrap.
  settings.permissions ??= {};
  settings.permissions.allow ??= [];
  const perm = `Bash(${ktBin} run:*)`;
  if (!settings.permissions.allow.includes(perm)) settings.permissions.allow.push(perm);

  const after = JSON.stringify(settings);
  if (after === before) return { changed: false };

  let backup: string | undefined;
  if (existsSync(settingsPath)) {
    backup = `${settingsPath}.bak`;
    copyFileSync(settingsPath, backup);
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return { changed: true, backup };
}

/**
 * Install one skill from the source file `skills/<name>.md` into the Claude Code skills directory
 * (target: <skillsDir>/<name>/SKILL.md - the name is derived from the source filename).
 * NEVER overwrite a skill the user already has (custom or not) - the same policy as statusLine.
 */
export function installSkill(skillsDir: string, sourcePath: string): { changed: boolean } {
  const target = join(skillsDir, basename(sourcePath, ".md"), "SKILL.md");
  if (existsSync(target)) return { changed: false };
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(sourcePath, target);
  return { changed: true };
}

export function runDoctor(home: string = homedir()): string {
  const settingsPath = join(home, ".claude", "settings.json");
  const lines: string[] = [];
  lines.push(`settings: ${existsSync(settingsPath) ? "✓ " + settingsPath : "✗ not found"}`);
  if (existsSync(settingsPath)) {
    let cfg: any;
    try {
      cfg = JSON.parse(readFileSync(settingsPath, "utf8") || "{}");
    } catch {
      lines.push("⚠ settings.json is not valid JSON — check it");
      return lines.join("\n") + "\n";
    }
    const hasStatus = statusLineUsesKt(String(cfg.statusLine?.command ?? ""), home);
    const cmds = (cfg.hooks?.PreToolUse ?? []).flatMap((m: Matcher) => m.hooks?.map((h) => h.command) ?? []);
    const allow: string[] = cfg.permissions?.allow ?? [];
    lines.push(`statusLine kt: ${hasStatus ? "✓" : "✗"}`);
    lines.push(`hook-guard:    ${cmds.includes("kt hook-guard") ? "✓" : "✗"}`);
    lines.push(`hook-compress: ${cmds.includes("kt hook-compress") ? "✓" : "✗"}`);
    const promptCmds = (cfg.hooks?.UserPromptSubmit ?? []).flatMap((b: Matcher) => b.hooks?.map((h) => h.command) ?? []);
    lines.push(`hook-prompt:  ${promptCmds.includes("kt hook-prompt") ? "✓" : "✗"}`);
    lines.push(`permission kt run: ${allow.includes("Bash(kt run:*)") ? "✓" : "✗ (missing Bash(kt run:*) in permissions.allow)"}`);
  }
  for (const name of ["concise-output", "lean-code"]) {
    const skillPath = join(home, ".claude", "skills", name, "SKILL.md");
    lines.push(`skill ${name}: ${existsSync(skillPath) ? "✓" : "✗ (run kt init)"}`);
  }
  lines.push(`bun: ${Bun.version}`);
  return lines.join("\n") + "\n";
}
