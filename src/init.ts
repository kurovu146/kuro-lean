import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, statSync } from "fs";
import { homedir } from "os";
import { join, dirname, basename } from "path";

// Khớp cả lời gọi trực tiếp (`kt status`, `/path/to/kt status`) lẫn qua biến (`"$KT" status`).
const KT_STATUS_RE = /(kt|\$\{?KT\}?)["']?\s+status\b/;

/**
 * statusLine có dùng kt không? Nhiều user wrap `kt status` trong script riêng
 * (vd `bash ~/.claude/scripts/statusline.sh` nối thêm usage) → đọc nội dung
 * file được tham chiếu trong command thay vì chỉ so chuỗi settings.json.
 */
function statusLineUsesKt(command: string, home: string): boolean {
  if (KT_STATUS_RE.test(command)) return true;
  for (const raw of command.split(/\s+/)) {
    const tok = raw.replace(/^["']|["']$/g, "");
    const p = tok.startsWith("~/") ? join(home, tok.slice(2)) : tok;
    try {
      if (existsSync(p) && statSync(p).isFile() && KT_STATUS_RE.test(readFileSync(p, "utf8"))) return true;
    } catch {
      // không đọc được → coi như không phải wrapper
    }
  }
  return false;
}

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

/**
 * Như ensureMatcher nhưng cho event KHÔNG theo tool (UserPromptSubmit, SessionEnd...):
 * những event này không có matcher, gắn vào chỉ tổ gây hiểu nhầm.
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

  // hooks.UserPromptSubmit: chặn lượt đầu tiên sau khi cache chết. Phải là hook TRƯỚC-khi-gửi;
  // statusline vẽ lại sau khi request đã đi nên chỉ kịp báo hoá đơn, không kịp cản.
  settings.hooks.UserPromptSubmit ??= [];
  ensureHook(settings.hooks.UserPromptSubmit, `${ktBin} hook-prompt`);

  // permissions.allow: lệnh sau rewrite là `kt run -- ...` nên allowlist cũ (vd Bash(bun test:*))
  // không khớp nữa → tự thêm để user khỏi bị prompt lại sau mỗi lần wrap.
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
 * Cài 1 skill từ file nguồn `skills/<name>.md` vào skills dir của Claude Code
 * (target: <skillsDir>/<name>/SKILL.md — tên suy từ tên file nguồn).
 * KHÔNG ghi đè nếu user đã có skill cùng tên (kể cả bản custom) — giống chính sách statusLine.
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
  lines.push(`settings: ${existsSync(settingsPath) ? "✓ " + settingsPath : "✗ chưa có"}`);
  if (existsSync(settingsPath)) {
    let cfg: any;
    try {
      cfg = JSON.parse(readFileSync(settingsPath, "utf8") || "{}");
    } catch {
      lines.push("⚠ settings.json không phải JSON hợp lệ — kiểm tra lại");
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
    lines.push(`permission kt run: ${allow.includes("Bash(kt run:*)") ? "✓" : "✗ (thiếu Bash(kt run:*) trong permissions.allow)"}`);
  }
  for (const name of ["concise-output", "lean-code"]) {
    const skillPath = join(home, ".claude", "skills", name, "SKILL.md");
    lines.push(`skill ${name}: ${existsSync(skillPath) ? "✓" : "✗ (chạy kt init)"}`);
  }
  lines.push(`bun: ${Bun.version}`);
  return lines.join("\n") + "\n";
}
