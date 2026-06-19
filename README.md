# kuro-lean (`kt`)

A CLI that cuts token usage for AI coding agents: it **compresses shell-command output**, measures
context, and blocks token-hungry commands. Guiding principle: **squash the noise, keep the signal** —
test failures and errors are always printed in full.

It works in two layers:

1. **Core CLI** (`kt run`, `kt show`, `kt status`) — a standalone Bun CLI. Runs **anywhere** Bun is
   installed, with any agent (or by hand).
2. **Auto-integration** (`kt init`) — registers a `PreToolUse` hook that transparently rewrites
   commands + a status line. This uses **Claude Code's** settings schema, so full automation is
   Claude Code–only. Other agents use the core CLI manually (see [Compatibility](#compatibility-with-ai-tools)).

## Requirements

- [Bun](https://bun.sh) ≥ 1.3 (the CLI entry point is `src/cli.ts`, run directly by Bun).

## Install

```bash
bun link            # put `kt` on your PATH
kt init             # (Claude Code) register the PreToolUse hook + status line in ~/.claude/settings.json
kt doctor           # verify the setup
```

- `kt init` **never overwrites** a custom status line — it only sets `kt status` if you don't have one
  yet. It writes a `.bak` backup before changing anything and is idempotent.
- After install, matching commands are rewritten to `kt run -- ...`. Add `Bash(kt run:*)` to
  `permissions.allow` (or click "always allow" the first time) so you aren't prompted.

## Compatibility with AI tools

| Tool | Output compression (`kt run`) | Auto command-rewrite | Guard (block big `cat`, `find /`…) | Status line |
|------|:---:|:---:|:---:|:---:|
| **Claude Code** | ✅ | ✅ (`kt init`) | ✅ (`kt init`) | ✅ (`kt init`) |
| **Cursor** | ✅ (manual) | ⚠️ nudge via rules | ❌ | ❌ |
| **OpenAI Codex CLI** | ✅ (manual) | ⚠️ nudge via `AGENTS.md` | ❌ | ❌ |
| **GitHub Copilot** | ✅ (manual) | ⚠️ nudge via instructions | ❌ | ❌ |
| **Gemini CLI / others** | ✅ (manual) | ⚠️ nudge via `GEMINI.md`/`AGENTS.md` | ❌ | ❌ |

**Why the difference:** Claude Code exposes a `PreToolUse` hook that can *rewrite* a shell command
(`updatedInput`) and *block* it (`permissionDecision: deny`) before it runs — that's the mechanism
`kt init` wires up. Other agents don't expose an equivalent "intercept and rewrite the shell command"
hook, so the guard and transparent rewrite can't be replicated, and the status-line protocol is
Claude Code–specific. The compression itself still works everywhere — you just invoke `kt run` yourself.

### Setup for non–Claude Code agents (manual / nudge mode)

1. Install the CLI (same as above): `bun link` so `kt` is on PATH.
2. **Either** call it directly whenever you run a noisy command:
   ```bash
   kt run -- <command>      # e.g. kt run -- npm test
   ```
3. **Or** add an instruction so the agent prefers `kt run` on its own. Drop this into the tool's
   instruction file:
   - **Cursor** → `.cursor/rules/kt.mdc` (or legacy `.cursorrules`)
   - **Codex CLI** → `AGENTS.md`
   - **GitHub Copilot** → `.github/copilot-instructions.md`
   - **Gemini CLI** → `GEMINI.md`

   Suggested text:
   > When running shell commands that produce long output (tests, builds, `git diff`, install logs),
   > invoke them as `kt run -- <command>` to compress the output and save tokens. Failures are kept
   > in full. Use `kt show` to see the full log of the last run.

   Note: this is a *nudge*, not enforcement — the agent decides whether to follow it. Only Claude
   Code enforces it via the hook.

## Bypass / disable

- `KT_RAW=1 kt run -- <cmd>` — run without compression.
- `KT_DISABLE=1` — kill switch: the hook stops rewriting **and** the guard stops blocking.

## Subcommands

- `kt run -- <cmd>` — run the command, print the compressed output, save the full log.
- `kt show [id]` — view the full log (latest run if no id).
- `kt status` — render a 3-line status line (reads JSON from stdin):
  - `🟢 model (ctx) · bar % · ~tok · ⏳quota · $cost`
  - `📁 dir · 🌿 branch ↑↓ · 📋 plan`
  - `📝 +/- · ✅ todo · 🔧 tools`
  - ⏳quota + 📋plan + ✅todo come from the CK-stack cache / transcript when available; they auto-hide otherwise.
- `kt init` / `kt doctor` — install into / inspect Claude Code settings.

## How compression works

Commands are classified into profiles and compressed accordingly (small/quiet output is left
untouched to avoid destroying signal):

| Profile | Behavior |
|---------|----------|
| **test** | pass → print only the summary line; **fail → keep everything from the first failure marker onward** (Expected/Received + stack trace), exit code preserved |
| **build** | OK → `✓ build OK`; otherwise → keep only `error`/`warning` lines |
| **install** | keep `added/removed/audited/vulnerabilit…` lines; on failure keep full output |
| **git** | `git diff` ≤ 40 lines kept as-is (the agent usually wants to *read* it); larger diffs → `path +adds -dels` per file. `git status`/`log` handled as generic |
| **generic** | > 40 lines → keep first 15 + last 10, hide the middle (`… [N lines hidden — kt show] …`) |

## Guard — block token-hungry calls before they run

A `PreToolUse` hook denies calls that would dump noise into the context, with a helpful reason:

- **Bash**: `find /` (whole-disk scan), `npm ls` without `--depth`, `tree` without `-L`, and
  `cat <file>` larger than `guard.maxCatKb` (default 100 KB).
- **Read** (`readNoise`): reading a whole **noise file** — lock files (`package-lock.json`,
  `yarn.lock`, `bun.lockb`, `go.sum`, `Cargo.lock`…), minified/generated (`*.min.js`, `*.min.css`,
  `*.map`), files under `node_modules/`/`dist/`/`build/`/`.next/`/`vendor/`/`coverage/`, or any file
  larger than `guard.maxReadKb` (default 500 KB). **Escape hatch:** reading with an `offset` or a
  small `limit` (≤ 400) is allowed — so you can still inspect a slice on purpose.

Read is already capped at 2000 lines by Claude Code, so the guard targets *noise*, not size of code
files. `KT_DISABLE=1` turns the guard off too.

## Safety guarantees

- **Watch / dev commands** (`yarn dev`, `tsc --watch`, `vitest watch`, …) are **not** wrapped, so they
  never hang the agent. `kt run` also enforces a 120s timeout — long-running commands are killed
  instead of blocking forever, and whatever output was produced is still returned.
- **Env-prefixed commands** (`GIT_PAGER=cat git diff`) and commands already containing `kt run` are
  **not** rewritten, so bash keeps the correct semantics (no `ENOENT` from spawning `FOO=1` as a binary).
- **Test/build failures are never compressed away** — the full error block and exit code are preserved.

## Measured results (measured on this repo, 2026-06-19)

Token estimate ≈ chars / 4. Reproduce with `bash scripts/measure.sh`.

| Command | Before (chars) | After (chars) | Saved |
|---------|---------------:|--------------:|-------|
| `git diff HEAD~10 HEAD` | 21,157 (~5.3k tok) | 504 (~126 tok) | **98%** |
| `bun test` (pass) | 103 | 89 | 14% |
| `git log --oneline -20` (small) | 1,310 | 1,310 | 0% (kept — correct) |
| `git status` (small) | 409 | 409 | 0% (kept — correct) |

**Notes:**
- The big wins are on long output (diffs, noisy test/build logs, error logs) — `git diff` saves ~98%.
- Already-compact output (`git status`, short `git log`) is **left untouched** to avoid breaking
  signal. That's intentional.
- `bun test` saves little because Bun's output is already terse; projects using jest/vitest/go test
  (verbose output) save far more.

## Configuration

Optional per-project `kt.json` (deep-merged over defaults):

```json
{
  "profiles": { "test": true, "build": true, "install": true, "git": true, "generic": true },
  "generic": { "thresholdLines": 40, "headLines": 15, "tailLines": 10 },
  "store": { "keepRuns": 50 },
  "statusline": { "warnPct": 60, "dangerPct": 85 },
  "guard": { "maxCatKb": 100, "rules": { "findRoot": true, "npmLs": true, "treeNoDepth": true, "catBig": true } }
}
```

Full logs are stored under `.kt/runs/` (last `keepRuns` kept) — already in `.gitignore`.

## Development

```bash
bun test            # run the test suite
```
