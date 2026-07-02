import { detect } from "../detect";

// Ký tự shell phức tạp (pipe/redirect/subshell/biến/newline) → để bash xử lý, đừng rewrite.
const COMPLEX_RE = /[|&;><`$\n]|\$\(/;
// Lệnh long-running (dev server, watch) → wrap sẽ buffer tới khi exit = treo. Để chạy raw.
const WATCH_RE = /(^|\s)(-w|--watch\S*|--watchAll)(\s|$)|\bwatch\b/;

/** Quote 1 chuỗi cho shell bằng nháy đơn (POSIX): ' → '\'' */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function decideCompress(command: string): string | null {
  if (process.env.KT_DISABLE === "1") return null;
  const cmd = command.trim();
  if (!cmd) return null;

  const firstTok = cmd.split(/\s+/)[0] ?? "";
  // đã là kt (hoặc có `kt run` ở giữa, vd bypass thủ công) → tránh double-wrap.
  if (firstTok === "kt" || /\bkt\s+run\b/.test(cmd)) return null;
  if (WATCH_RE.test(cmd)) return null;
  if (detect(cmd) === "generic") return null;

  // `2>&1` chỉ gộp stderr vào stdout (kt vốn đã gộp cả hai) → coi là vô hại khi xét độ phức tạp.
  const stripped = cmd.replace(/\s*2>&1\s*/g, " ").trim();
  if (COMPLEX_RE.test(stripped)) return null;

  // env-prefix (`FOO=1 cmd`) hoặc còn `2>&1` → spawn array không hiểu → chạy qua bash -lc.
  if (firstTok.includes("=") || stripped !== cmd) return `kt run -- bash -lc ${shellQuote(cmd)}`;
  return `kt run -- ${cmd}`;
}
