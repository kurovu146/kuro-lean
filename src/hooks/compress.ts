// Complex shell characters (pipe/redirect/subshell/variable/background/newline) → leave them to bash, don't rewrite.
// `&&` is NOT in this set: an `a && b` chain is split and each side judged separately (see decideCompress).
const COMPLEX_RE = /[|&;><`$\n]|\$\(/;
// Long-lived commands (dev server, watch, tail -f) → wrapping buffers until exit = hangs until the timeout.
const LONG_RE =
  /(^|\s)(-w|--watch\S*|--watchAll)(\s|$)|\b(watch|nodemon)\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview)\b|\b(next|vite|nuxt|astro|remix)\s+dev\b|\btail\s+-\w*f\b|\blogs\s+(-\w*f|--follow)\b|\bping\s/;
// Commands that change the main shell's state (cwd, env, version manager). Claude Code keeps shell state
// between Bash calls → putting them in a subshell loses the effect and later commands run in the wrong place.
const SHELL_STATE_RE = /^(cd|export|source|\.|alias|unalias|set|unset|shopt|nvm|fnm|pushd|popd|trap|umask)\b/;
// Needs a tty: `kt run` runs with stdin ignored → these commands break or hang if wrapped.
const TTY_CMDS = new Set([
  "sudo", "ssh", "scp", "sftp", "vim", "vi", "nano", "emacs", "less", "more", "top", "htop",
  "man", "claude", "psql", "mysql", "sqlite3", "redis-cli", "gdb", "lldb", "ftp", "telnet", "fzf",
]);
// REPLs: only dangerous when called bare (`node`); with an argument (`node script.js`) it runs and exits.
const REPL_CMDS = new Set(["node", "python", "python3", "bun", "deno", "irb", "ruby", "php"]);
const TTY_RE = /(^|\s)-(it|ti)(\s|$)|--interactive\b|\bgh auth login\b|\bgit (rebase|add|commit|checkout) -i\b|\bnpm login\b/;

/** Single-quote a string for the shell (POSIX). */
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
  // already kt (or has `kt run` somewhere inside, e.g. a manual bypass) → avoid double-wrapping.
  if (firstTok === "kt" || /\bkt\s+run\b/.test(cmd)) return null;
  if (LONG_RE.test(cmd) || TTY_RE.test(cmd)) return null;

  // Split on `&&` to judge each side. `2>&1` has only one `&` so it isn't cut here;
  // it is stripped when judging complexity, since kt merges stdout+stderr anyway.
  const parts = cmd.split("&&").map((p) => p.trim());
  const bare = parts.map((p) => p.replace(/\s*2>&1\s*/g, " ").trim());
  if (bare.some((p) => !p || COMPLEX_RE.test(p))) return null;
  if (needsTty(bare)) return null;

  // `cd X && …`: keep the cd in the main shell and wrap only what follows — otherwise the cwd of later
  // commands is wrong. Any other state-changing command (or a cd mid-chain) is left unrewritten.
  const prefix = parts.length > 1 && /^cd\s/.test(bare[0]!) ? (bare.shift(), parts.shift()!) : "";
  if (bare.some((p) => SHELL_STATE_RE.test(p))) return null;

  const rest = parts.join(" && ").trim();
  // multiple parts, an env prefix (`FOO=1 cmd`) or a leftover `2>&1` → a spawn array can't express it → run via bash -c.
  // Do NOT use -l: a login shell sources the profile → PATH can differ from unwrapped commands, and it's slower.
  const needsBash = parts.length > 1 || (bare[0]!.split(/\s+/)[0] ?? "").includes("=") || /2>&1/.test(rest);
  const wrapped = needsBash ? `kt run -- bash -c ${shellQuote(rest)}` : `kt run -- ${rest}`;
  return prefix ? `${prefix} && ${wrapped}` : wrapped;
}
