# Contributing

Thanks for looking. kt is a small, opinionated tool — the bar for adding surface area is high, and
the bar for adding *measurements* is low. Both of those are on purpose.

## Setup

```bash
bun install
bun test            # must be green before you push
bun run typecheck   # tsc --noEmit
bun link            # optional: put your working copy on PATH as `kt`
```

Requires [Bun](https://bun.sh) ≥ 1.3. There is no build step — `src/cli.ts` runs directly.

## The one rule that matters

**Claims in this repo are measured, not estimated.** The README states that plainly, including in
the places where it says kt does *not* help. If you add a feature that claims to save tokens, show
the number and how you got it:

- per-command savings → `bash scripts/measure.sh`
- end-to-end effect on a real agent session → `kt bench --runs 3`

A change that sounds like it should save tokens and hasn't been measured is exactly the kind of
change `kt bench` was written to catch — the small-output pass-through exists *because* the
benchmark showed compression was a net loss there.

## Code style

- Write less. There is a `lean-code` skill shipped in `skills/` that describes the ladder the
  codebase follows: reuse → stdlib → existing dep → one line → minimum. It applies to docs too.
- Comments state constraints the code cannot state itself. They do not narrate the next line.
- Where simplicity is deliberate, mark it: `// kt: <limitation> — revisit when <condition>`.
- English only in code, comments, tests and output. The one exception is string literals that
  reproduce something actually observed in a transcript — those stay verbatim, because changing
  them changes what the test proves.

## Tests

Every non-trivial change ships with the smallest test that fails when the logic is wrong.

Two traps this repo has hit before, both now conventions:

- **Inject `home`, never call `homedir()` in a test.** CI runs as `/home/runner`, so a `~`-shortened
  path passes locally and fails on Actions.
- **Don't assert on a ranked slice by position** unless the ranking returns an exact top-N. Row 7 of
  a 10-row table and row 7 of a 20-row table were once different sessions.

## Commits and PRs

- [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`, English.
- One logical change per commit. A large diff is easier to review split along file boundaries.
- Say what you measured in the commit body, not just what you changed.

CI runs `bun run typecheck` and `bun test` on every push and PR to `main`.
