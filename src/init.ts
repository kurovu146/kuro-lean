import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

interface HookEntry { type: "command"; command: string }
interface Matcher { matcher: string; hooks: HookEntry[] }

/** Đảm bảo matcher tồn tại và chứa đủ các command (idempotent, không tạo block trùng). */
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

function parseSettings(settingsPath: string): any {
  if (!existsSync(settingsPath)) return {};
  const raw = readFileSync(settingsPath, "utf8") || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${settingsPath} không phải JSON hợp lệ — sửa tay rồi chạy lại (không đụng để khỏi mất dữ liệu).`);
  }
}

export function installSettings(settingsPath: string, ktBin: string): { changed: boolean; backup?: string } {
  const settings: any = parseSettings(settingsPath);

  const before = JSON.stringify(settings);

  // statusLine: chỉ set khi user CHƯA có statusLine nào.
  // KHÔNG ghi đè statusLine custom của user (vd statusline.cjs riêng).
  const wantStatus = `${ktBin} status`;
  if (!settings.statusLine) {
    settings.statusLine = { type: "command", command: wantStatus, padding: 2 };
  }

  // hooks.PreToolUse: Bash (guard trước, compress sau) + Read (guard chặn file nhiễu)
  settings.hooks ??= {};
  settings.hooks.PreToolUse ??= [];
  ensureMatcher(settings.hooks.PreToolUse, "Bash", [`${ktBin} hook-guard`, `${ktBin} hook-compress`]);
  ensureMatcher(settings.hooks.PreToolUse, "Read", [`${ktBin} hook-guard`]);

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

export function runDoctor(home: string = homedir()): string {
  const settingsPath = join(home, ".claude", "settings.json");
  const lines: string[] = [];
  lines.push(`settings: ${existsSync(settingsPath) ? "✓ " + settingsPath : "✗ chưa có"}`);
  if (existsSync(settingsPath)) {
    let cfg: any;
    try {
      cfg = JSON.parse(readFileSync(settingsPath, "utf8") || "{}");
    } catch {
      lines.push("⚠ settings.json không phải JSON hợp lệ — kiểm tra lại");
      return lines.join("\n") + "\n";
    }
    const hasStatus = String(cfg.statusLine?.command ?? "").includes("kt status");
    const cmds = (cfg.hooks?.PreToolUse ?? []).flatMap((m: Matcher) => m.hooks?.map((h) => h.command) ?? []);
    lines.push(`statusLine kt: ${hasStatus ? "✓" : "✗"}`);
    lines.push(`hook-guard:    ${cmds.includes("kt hook-guard") ? "✓" : "✗"}`);
    lines.push(`hook-compress: ${cmds.includes("kt hook-compress") ? "✓" : "✗"}`);
  }
  lines.push(`bun: ${Bun.version}`);
  return lines.join("\n") + "\n";
}
