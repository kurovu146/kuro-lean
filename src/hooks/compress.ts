import { detect } from "../detect";

// Ký tự shell phức tạp (pipe/redirect/subshell/biến/newline) → để bash xử lý, đừng rewrite.
const COMPLEX_RE = /[|&;><`$\n]|\$\(/;
// Lệnh long-running (dev server, watch) → wrap sẽ buffer tới khi exit = treo. Để chạy raw.
const WATCH_RE = /(^|\s)(-w|--watch\S*|--watchAll)(\s|$)|\bwatch\b/;

export function decideCompress(command: string): string | null {
  if (process.env.KT_DISABLE === "1") return null;
  const cmd = command.trim();
  if (!cmd) return null;

  const firstTok = cmd.split(/\s+/)[0] ?? "";
  // env-prefix (`FOO=1 cmd`) → spawn array sẽ coi `FOO=1` là binary → ENOENT. Để bash xử lý.
  if (firstTok.includes("=")) return null;
  // đã là kt (hoặc có `kt run` ở giữa, vd bypass thủ công) → tránh double-wrap.
  if (firstTok === "kt" || /\bkt\s+run\b/.test(cmd)) return null;

  if (COMPLEX_RE.test(cmd)) return null;
  if (WATCH_RE.test(cmd)) return null;
  if (detect(cmd) === "generic") return null;
  return `kt run -- ${cmd}`;
}
