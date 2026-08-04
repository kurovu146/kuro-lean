---
name: lean-code
description: Write LESS when implementing — climb the "efficiency ladder" before writing (YAGNI → reuse → stdlib → existing dep → one line → minimum), and apply the same discipline to DOCUMENTATION, which is most of the text produced. For every code-writing task. NEVER cut validation, error handling, security, or accessibility.
---

# Lean Code

Before writing code, stop at the FIRST rung that satisfies:

1. Does it need to exist at all? No → don't write it (YAGNI).
2. Does the codebase already have a helper/pattern for this? → reuse it.
3. Can the stdlib do it? → use the stdlib.
4. Does the platform have it natively? → use that.
5. Can an ALREADY INSTALLED dependency do it? → use it (don't add a new dep).
6. Is one line enough? → write one line.
7. Only then: write the minimum working code.

## Documentation counts too

Measured: **60% of the text written through `Write` is `.md`**, not code — plans, specs, reports; the
largest file reached 112k characters. The ladder above applies to documentation identically:

- A longer document doesn't make a better plan. Write enough to act on, then stop.
- Don't erect empty sections to fill a template ("Risks: none", "Appendix: N/A") — drop the section.
- Don't copy into a document what already exists in the code, the issue, or the conversation just above.
- If one table replaces three paragraphs, use the table.
- Scratch documents (a plan/spec for one task) are short-lived — don't polish them like product docs.

## Pick the right writing tool

- Changing an existing file → `Edit`, don't `Write` the whole file back. (The median `Edit` is 633
  characters, the median `Write` 3,028 — overwriting a whole file to change a few lines costs ~5×
  as much and risks losing other content.)
- Don't write files with a heredoc in `Bash` when `Write`/`Edit` would do — heredocs currently make up
  35% of the characters in Bash commands, and they carry no overwrite check.

## Hard rules

- NO abstraction/option/config nobody asked for. NO surplus boilerplate.
- Deleting beats adding. Boring beats clever. As few files as possible.
- Complicated request → ask back: "is X really needed, or is Y enough?"
- Fix bugs at the root cause (the shared function), don't patch each caller.
- Where simplicity is DELIBERATE → mark it `// kt: <limitation> — revisit when <condition>`.
- Comments only state constraints the code can't state itself — never narrate the next line.

NEVER be lazy about: understanding the problem before coding, validation at trust boundaries, error
handling that prevents data loss, security, accessibility, or an explicitly requested feature.

Every non-trivial implementation ships with EXACTLY ONE runnable check (the smallest test that fails
when the logic is wrong).
