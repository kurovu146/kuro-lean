// Ký tự shell phức tạp (pipe/redirect/subshell/biến/nền/newline) → để bash xử lý, đừng rewrite.
// `&&` KHÔNG nằm ở đây: chuỗi `a && b` được tách ra xét từng vế (xem decideCompress).
const COMPLEX_RE = /[|&;><`$\n]|\$\(/;
// Lệnh sống lâu (dev server, watch, tail -f) → wrap sẽ buffer tới khi exit = treo tới timeout.
const LONG_RE =
  /(^|\s)(-w|--watch\S*|--watchAll)(\s|$)|\b(watch|nodemon)\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview)\b|\b(next|vite|nuxt|astro|remix)\s+dev\b|\btail\s+-\w*f\b|\blogs\s+(-\w*f|--follow)\b|\bping\s/;
// Lệnh đổi trạng thái shell chính (cwd, env, version manager). Claude Code giữ shell state giữa
// các lệnh Bash → nhét vào subshell là mất tác dụng, lệnh sau chạy sai chỗ.
const SHELL_STATE_RE = /^(cd|export|source|\.|alias|unalias|set|unset|shopt|nvm|fnm|pushd|popd|trap|umask)\b/;
// Cần tty: `kt run` chạy với stdin ignore → những lệnh này sẽ hỏng/treo nếu bị wrap.
const TTY_CMDS = new Set([
  "sudo", "ssh", "scp", "sftp", "vim", "vi", "nano", "emacs", "less", "more", "top", "htop",
  "man", "claude", "psql", "mysql", "sqlite3", "redis-cli", "gdb", "lldb", "ftp", "telnet", "fzf",
]);
// REPL: chỉ nguy hiểm khi gọi trần (`node`); có tham số (`node script.js`) là lệnh chạy rồi thoát.
const REPL_CMDS = new Set(["node", "python", "python3", "bun", "deno", "irb", "ruby", "php"]);
const TTY_RE = /(^|\s)-(it|ti)(\s|$)|--interactive\b|\bgh auth login\b|\bgit (rebase|add|commit|checkout) -i\b|\bnpm login\b/;

/** Quote 1 chuỗi cho shell bằng nháy đơn (POSIX): ' → '\'' */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function needsTty(parts: string[]): boolean {
  return parts.some((p) => {
    const toks = p.split(/\s+/);
    const first = toks[0] ?? "";
    return TTY_CMDS.has(first) || (REPL_CMDS.has(first) && toks.length === 1);
  });
}

export function decideCompress(command: string): string | null {
  if (process.env.KT_DISABLE === "1") return null;
  const cmd = command.trim();
  if (!cmd) return null;

  const firstTok = cmd.split(/\s+/)[0] ?? "";
  // đã là kt (hoặc có `kt run` ở giữa, vd bypass thủ công) → tránh double-wrap.
  if (firstTok === "kt" || /\bkt\s+run\b/.test(cmd)) return null;
  if (LONG_RE.test(cmd) || TTY_RE.test(cmd)) return null;

  // Tách chuỗi `&&` để xét từng vế. `2>&1` chỉ có một `&` nên không cắt nhầm ở đây;
  // nó được gỡ khi xét độ phức tạp vì kt vốn đã gộp stdout+stderr.
  const parts = cmd.split("&&").map((p) => p.trim());
  const bare = parts.map((p) => p.replace(/\s*2>&1\s*/g, " ").trim());
  if (bare.some((p) => !p || COMPLEX_RE.test(p))) return null;
  if (needsTty(bare)) return null;

  // `cd X && …`: giữ cd ở shell chính, chỉ wrap phần sau — nếu không, cwd của các lệnh
  // tiếp theo sẽ sai. Mọi lệnh đổi-state khác (hoặc cd ở giữa chuỗi) thì không rewrite.
  const prefix = parts.length > 1 && /^cd\s/.test(bare[0]!) ? (bare.shift(), parts.shift()!) : "";
  if (bare.some((p) => SHELL_STATE_RE.test(p))) return null;

  const rest = parts.join(" && ").trim();
  // nhiều vế, env-prefix (`FOO=1 cmd`) hoặc còn `2>&1` → spawn array không hiểu → chạy qua bash -c.
  // KHÔNG dùng -l: login shell source profile → PATH có thể lệch với lệnh không-wrap + chậm.
  const needsBash = parts.length > 1 || (bare[0]!.split(/\s+/)[0] ?? "").includes("=") || /2>&1/.test(rest);
  const wrapped = needsBash ? `kt run -- bash -c ${shellQuote(rest)}` : `kt run -- ${rest}`;
  return prefix ? `${prefix} && ${wrapped}` : wrapped;
}
