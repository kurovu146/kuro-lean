# Security

## Reporting a vulnerability

Please report privately via [GitHub Security Advisories](https://github.com/kurovu146/kuro-lean/security/advisories/new)
rather than opening a public issue. Include what you ran, what happened, and what you expected.

This is a solo-maintained project — expect a first response within about a week.

## What kt touches

Worth knowing before you install it, because kt sits in a privileged spot: it reads your agent's
transcripts and rewrites the shell commands your agent runs.

| Surface | What kt does |
|---|---|
| **Network** | **Nothing.** There is no `fetch`, no HTTP client and no socket anywhere in `src/`. kt never uploads a transcript, a command or a log |
| **Processes spawned** | Exactly three: the command you asked it to run (`kt run`), your platform's clipboard binary (`kt handoff --copy`), and the `claude` CLI (`kt bench`, which you have to invoke on purpose) |
| **Files read** | Claude Code transcripts under `~/.claude/projects/`, `~/.claude/settings.json`, and the CK-stack cache files in your temp dir if present. Transcripts contain your conversations — `kt cost`, `kt stats` and `kt handoff` all parse them locally |
| **Files written** | `~/.claude/settings.json` (only via `kt init`, always after writing a `.bak`), skills into `~/.claude/skills/` (never overwriting an existing one), and run logs under `.kt/runs/` in the current project |
| **Output** | `kt handoff --recover` prints part of a transcript to stdout or your clipboard. That text is yours to paste — check it before pasting anywhere public |

## The trade-off `kt init` makes

`kt init` adds `Bash(kt run:*)` to `permissions.allow` in your Claude Code settings. This is a
wildcard: any command invoked *through* `kt run` is auto-approved, so your agent stops being
prompted per command.

That is a deliberate loosening of Claude Code's permission prompts, and it is the single most
security-relevant thing kt does. It is documented in the README, and if you would rather keep
per-command prompting, remove that one entry — everything else keeps working.

`KT_DISABLE=1` turns off the rewriting, the guard and the prompt hook without uninstalling anything.

## Scope

In scope: command-rewriting bugs that change what a command does, guard bypasses, anything that
causes kt to transmit data off the machine, and path handling that lets kt write outside the paths
listed above.

Out of scope: the `Bash(kt run:*)` wildcard itself (documented above, and opt-out), and anything
requiring an attacker who can already write to your `~/.claude/settings.json`.
