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
- `kt init` also adds `Bash(kt run:*)` to `permissions.allow` (so rewritten commands don't re-prompt)
  and installs the `concise-output` + `lean-code` skills into `~/.claude/skills/` (trim the model's
  own output — the most expensive tokens; `lean-code` makes the model write less code via an
  efficiency ladder inspired by the [ponytail](https://github.com/DietrichGebert/ponytail) project
  (reuse → stdlib → existing deps → minimum)). None of these overwrite existing user versions.
- **Trade-off to know:** `Bash(kt run:*)` is a wildcard — anything invoked *through* `kt run` is
  auto-approved (its output still goes through the compressor + char cap, so the token risk stays
  neutralized). If you want per-command prompting instead, remove that entry from `permissions.allow`.

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
   > in full, and small outputs are printed verbatim without compression. When output WAS compressed
   > (a `kt show <id>` hint is appended), use `kt show` to see the full log.

   Note: this is a *nudge*, not enforcement — the agent decides whether to follow it. Only Claude
   Code enforces it via the hook.

## Bypass / disable

- `KT_RAW=1 kt run -- <cmd>` — run without compression.
- `KT_DISABLE=1` — kill switch: the hook stops rewriting **and** the guard stops blocking.

## Subcommands

- `kt run -- <cmd>` — run the command, print the compressed output, save the full log.
  **Small outputs pass through untouched**: if the raw output is under `run.rawUnderChars`
  (default 4000 chars ≈ 1k tokens), `kt run` prints it verbatim — no compression, no log/meta.
  Rationale: `kt bench` measured that compressing tiny outputs makes the model spend extra
  verification turns (each turn re-reads the whole context), costing more than it saves.
  Compression only kicks in where the win is real. Set `"run": { "rawUnderChars": 0 }` to disable.
- `kt show [id]` — view the full log (latest run if no id).
- `kt stats` — savings report from real usage: total % saved (~tokens) + top commands still
  occupying context after compression (candidates for new patterns/guards). Data comes from
  `.kt/runs/index.jsonl`, one line per run, auto-trimmed.
- `kt cost [dir]` — the actual bill, from real `usage` in the Claude Code transcripts for this
  project (main session + subagents), broken down by **cache read / cache write / output / fresh
  input** and by model. Prices come from `pricing` in `kt.json` (USD per 1M tokens, matched by model-id
  prefix); a model with no entry is skipped rather than guessed at. This is the counterpart to
  `kt stats`: `stats` measures the shell output kt compressed, `cost` measures where the money
  actually goes — usually not the same place. See [Where the money goes](#where-the-money-goes).
- `kt status` — render a 3-line status line (reads JSON from stdin):
  - `🟢 model (ctx) · bar % · ~tok · ⏳quota · $cost · $x.xx/lượt`
  - `📁 dir · 🌿 branch ↑↓ · 📋 plan`
  - `📝 +/- · ✅ todo · 🔧 tools · ♻️ ~saved`
  - ⏳quota + 📋plan + ✅todo come from the CK-stack cache / transcript when available; they auto-hide otherwise.
  - ♻️ shows tokens saved by kt for this project (same data as `kt stats`, ≈ chars/4); hidden until
    the first compressed run.
  - `$x.xx/lượt` is what it costs to re-read the current context on **every following turn**
    (`tokens × 0.1 × input price` — the cache-read rate). It grows as the context fills and is the
    cheapest reminder that `/clear` between unrelated tasks is worth money. Needs `model.id` in the
    status-line JSON and a matching `pricing` entry; hidden otherwise.
- `kt bench [--runs N] [--model M] [--max-turns T] [--keep]` — A/B benchmark end-to-end: runs REAL headless
  Claude Code sessions on a seeded bug-fix task, `baseline` arm (hooks disabled via `KT_DISABLE=1`) vs `kt` arm
  (hook wired in workspace settings), reports median context tokens / output tokens / cost / turns / duration.
  ⚠ Spends real API quota (default: 3 runs × 2 arms on Haiku). Needs `claude` CLI + `kt` on PATH.
- `kt init` / `kt doctor` — install into / inspect Claude Code settings.

## How compression works

Commands are classified into profiles and compressed accordingly (small/quiet output is left
untouched to avoid destroying signal):

| Profile | Behavior |
|---------|----------|
| **test** | pass → print only the summary line; **fail → keep everything from the first failure marker onward** (Expected/Received + stack trace), exit code preserved. Runs of ≥2 consecutive stack frames pointing into `node_modules`/`node:*` collapse to one `… (N lib frames hidden)` line — your own frames stay intact |
| **build** | OK → `✓ build OK`; otherwise → keep only `error`/`warning` lines |
| **lint** | `eslint`, `golangci-lint`, `<pm> run lint` — same as build: clean → 1 line, otherwise error/warning lines only |
| **install** | keep `added/removed/audited/vulnerabilit…` lines; on failure keep full output |
| **git** | `git diff` ≤ 40 lines kept as-is (the agent usually wants to *read* it); larger diffs → `path +adds -dels` per file. `git status`/`log` handled as generic |
| **generic** | everything else (`grep`, `sed`, `ls`, `cat`, `go run`…) — kept verbatim; the char cap below is its only compression. Middle-of-output matters too often here, and cutting it costs the agent a `kt show` turn. Set `generic.thresholdLines` > 0 to re-enable the old head/tail cut (first `headLines` + last `tailLines`, middle hidden) |

Package-manager scripts are recognized too: `npm/pnpm/yarn/bun run test|build|lint` (and the
no-`run` variants) map to their profile.

**Absolute char cap (`limits.maxChars`, default 16,000 ≈ 4k tokens):** applied *after* every
profile — including fallbacks. Catches what line-counting misses (a single giant minified/JSON
line, a huge failing suite): keeps 65% head + 35% tail with a `… [cut ~N KB — kt show] …` marker.
Set to `0` to disable.

### Which commands the hook rewrites

`kt hook-compress` rewrites a Bash command into `kt run -- …` unless one of these applies:

- **Pipes / redirects / subshells / newlines** (`|`, `;`, `>`, `` ` ``, `$(…)`, `&`) — left to bash.
  `2>&1` is the exception (kt merges both streams anyway) and routes through `bash -c`.
- **`&&` chains** are rewritten as a whole through `bash -c`, *except* a leading `cd X &&`: the `cd`
  stays outside the wrapper, because Claude Code keeps the shell's working directory between Bash
  calls — burying it in a subshell would leave every later command in the wrong directory. A `cd`
  (or `export`/`source`/`nvm`…) anywhere *later* in the chain disables the rewrite entirely.
- **Long-running commands** (`--watch`, `nodemon`, `<pm> run dev|start|serve`, `next dev`,
  `tail -f`, `… logs -f`, `ping`) — wrapping them buffers until exit, i.e. hangs until the timeout.
- **Commands needing a tty** (`sudo`, `ssh`, `vim`, `less`, `psql`, `docker … -it`, `gh auth login`,
  `git rebase -i`, a bare `node`/`python3` REPL…) — `kt run` runs with stdin ignored.

### How much this actually saves

Measured over 12,220 real Bash calls from ~2 months of Claude Code transcripts (9.8M chars of tool
output), the honest answer is: **less than you'd hope, and it depends entirely on your output shape.**

| Output size per command | Calls | Share of all chars |
|---|---:|---:|
| < 4,000 ch → passed through untouched | 11,827 | 72% |
| 4,000–16,000 ch | 381 | 25% |
| > 16,000 ch → the char cap bites | 12 | 2% |

Context there is eaten by the *number* of small commands, not by a few giant ones — and compressing
small outputs is exactly what `kt bench` measured as a net loss (extra verification turns). So on
that workload the default config saves ~0–1%. Turning the old aggressive head/tail cut back on
(`generic.thresholdLines: 40`) simulates to ~7%, but that is the setting the benchmark found costs
extra agent turns — measure with `kt bench` before trusting it.

**Where kt still earns its place:** capping the rare huge dump, the guard (blocking `find /`,
`cat` on a 5 MB file, whole lock files) before those tokens ever exist, and the two skills it
installs (`concise-output`, `lean-code`) which trim the model's *own* output.
Treat `♻️ saved` as "disasters averted", not as a running discount.

### Where the money goes

Same transcripts, 93,124 assistant messages with `usage`, priced at list rates (cache write at the
1-hour-TTL 2× multiplier):

| Token kind | Multiplier | Share of the bill |
|---|---|---:|
| cache read | 0.1× input | **45%** |
| cache write | 2× input | **44%** |
| output | 5× input | 10% |
| fresh input | 1× | 0.3% |

Output is the priciest token *per token* and still only a tenth of the bill. The 89% is the cost of
**putting things into the context and carrying them**, because a token you load is billed twice over:

```
cost of 1 loaded token = 2× input  (cache write, once)
                       + 0.1× input × turns remaining  (re-read every turn)
```

On Opus 5 with 30 turns left that is $10 + $15 per million — **more than a token the model writes**
($25/M). A whole-file `Read` early in a long session outcosts the code generated from it.

Two consequences worth internalizing, both of which kt can only *show* you, not fix:

1. The lever is not compressing what arrives — it is **not loading it**, and **not carrying it** (`/clear`
   between unrelated tasks; subagents, whose context dies with them instead of being re-read every turn).
2. Filtering individual operations can't reach this. Measured on the same data, a guard that blocked
   un-`limit`ed `Read`s of ≥20k chars nets ~0.3% — the extra turns it forces eat most of what it saves,
   the same trap the `rawUnderChars` benchmark found. That is why no such rule ships here.

`kt cost` prints this table for your own project. `$x.xx/lượt` on the status line is the same
arithmetic applied live to the session you're in.

## Guard — block token-hungry calls before they run

A `PreToolUse` hook denies calls that would dump noise into the context, with a helpful reason:

- **Bash**: `find /` (whole-disk scan), `npm ls` without `--depth`, `tree` without `-L`,
  `git log` with `-p`/`--patch` (full patch of every commit — use `git log --oneline` +
  `git show <sha> -- <file>`), and `cat <file>` larger than `guard.maxCatKb` (default 100 KB).
- **Read** (`readNoise`): reading a whole **noise file** — lock files (`package-lock.json`,
  `yarn.lock`, `bun.lockb`, `go.sum`, `Cargo.lock`…), minified/generated (`*.min.js`, `*.min.css`,
  `*.map`), files under `node_modules/`/`dist/`/`build/`/`.next/`/`vendor/`/`coverage/`, or any file
  larger than `guard.maxReadKb` (default 500 KB). **Escape hatch:** reading with an `offset` or a
  small `limit` (≤ 400) is allowed — so you can still inspect a slice on purpose.

Read is already capped at 2000 lines by Claude Code, so the guard targets *noise*, not size of code
files. `KT_DISABLE=1` turns the guard off too.

## Safety guarantees

- **Watch / dev commands** (`yarn dev`, `tsc --watch`, `vitest watch`, …) are **not** wrapped, so they
  never hang the agent. `kt run` also enforces a timeout (`run.timeoutMs`, default 120s — raise it in
  `kt.json` for slow e2e suites) — long-running commands are killed instead of blocking forever, and
  whatever output was produced is still returned.
- **Env-prefixed commands** (`GIT_PAGER=cat git diff`) and `2>&1` **are** compressed: they're wrapped
  as `kt run -- bash -lc '<cmd>'` (single quotes escaped), so bash keeps the correct semantics.
  Commands with real pipes/redirects/`&&` are still left untouched, as is anything already
  containing `kt run`.
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

## End-to-end benchmark (`kt bench`)

`kt bench` — real headless Claude Code sessions on a seeded bug-fix task (~50 tests, 1 planted bug),
median of 3 runs/arm, model Haiku 4.5, 2026-07-05. Correctness gate: a run only counts if the
fixture test suite is green after the session — 6/6 runs valid here.

| Metric (median) | baseline | kt | Δ |
|---|---|---|---|
| Context tokens (in+cache) | 254,205 | 340,371 | 34% |
| Output tokens | 2,934 | 2,916 | -1% |
| Cost (USD) | $0.0750 | $0.0855 | 14% |
| Turns | 8 | 11 | 38% |
| Duration | 40.3s | 43.1s | 7% |

**Honest reading:**

- On this small fixture the `kt` arm cost **more** end-to-end: the kt sessions took more agent turns
  (median 11 vs 8), and each extra turn re-reads the whole conversation context — which swamped the
  few KB of tool-output compression per run.
- Per-command compression savings are real and measured separately (the per-command table above,
  `scripts/measure.sh`); they pay off when command outputs are large — this fixture's `bun test`
  output is only a few KB.
- Takeaway: measure on your own workload with `kt bench --runs N`. Small-output tasks are where the
  hook can cost more than it saves.
- **Follow-up shipped:** this result led to the small-output pass-through (`run.rawUnderChars`,
  see `kt run` above) — outputs under the threshold are no longer compressed at all, so the
  losing case measured here is now bypassed by default.

Re-measured after the pass-through (same task, 2026-07-09, median of 3 runs/arm, 6/6 valid):

| Metric (median) | baseline | kt | Δ |
|---|---|---|---|
| Context tokens (in+cache) | 238,612 | 239,830 | 1% |
| Output tokens | 2,924 | 3,256 | 11% |
| Cost (USD) | $0.0739 | $0.0781 | 6% |
| Turns | 8 | 8 | 0% |
| Duration | 38.3s | 37.3s | -3% |

The extra-turns penalty is gone (8 vs 8); the remaining deltas are within run-to-run noise.
On small-output tasks kt is now neutral instead of a net loss — the wins stay where outputs are big.

Reproduce: `kt bench --runs 3`.

## Configuration

Optional per-project `kt.json` (deep-merged over defaults):

```json
{
  "profiles": { "test": true, "build": true, "install": true, "git": true, "lint": true, "generic": true },
  "generic": { "thresholdLines": 0, "headLines": 15, "tailLines": 10 },
  "limits": { "maxChars": 16000 },
  "run": { "timeoutMs": 120000, "rawUnderChars": 4000 },
  "store": { "keepRuns": 50 },
  "statusline": { "warnPct": 60, "dangerPct": 85 },
  "guard": { "maxCatKb": 100, "maxReadKb": 500, "rules": { "findRoot": true, "npmLs": true, "treeNoDepth": true, "gitLogP": true, "catBig": true, "readNoise": true } },
  "pricing": { "claude-opus-5": { "input": 5, "output": 25 }, "claude-sonnet-5": { "input": 3, "output": 15 } }
}
```

`pricing` is USD per 1M tokens, keyed by model-id **prefix** (longest match wins, so
`claude-haiku-4-5-20251001` resolves via `claude-haiku-4-5`). It is merged over the built-in table
rather than replacing it — override only what has changed. List prices move; this is the one knob to
correct when `kt cost` looks off.

Full logs are stored under `.kt/runs/` (last `keepRuns` kept) — already in `.gitignore`.

## Development

```bash
bun install         # dev deps (typescript + @types/bun for typecheck)
bun test            # run the test suite
bun run typecheck   # tsc --noEmit
```

CI (GitHub Actions) runs both on every push/PR to `main`.
