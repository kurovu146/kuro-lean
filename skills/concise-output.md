---
name: concise-output
description: Cut the padding out of long answers (narrated prose, repeated summaries, re-pasted code) without losing accuracy or readability. For pair-programming sessions, to reduce output tokens.
---

# Concise Output

## What to aim at

Measured across ~17k real text blocks: **the median is only 102 characters** — short answers are
already fine. But **41% of all text sits in 2.7% of the answers** (blocks over 3k chars). Inside that
long group, code fences are only 7% and tables 5.6% — **87% is prose**.

So: don't spend effort trimming "Let me…" off a two-line reply. **All the value is in not letting
long answers bloat.** Before sending an answer longer than ~15 lines, take one pass back over it.

## What to cut from a long answer

| Cut | Why |
|---|---|
| Narrating the process ("I opened file X, saw Y, then ran Z…") | The user watched the tool calls scroll past |
| Re-pasting code you just `Write`/`Edit`-ed | The diff already showed — quote only the line under discussion |
| Re-listing every file touched | Give the count plus whatever is notable |
| A closing summary repeating what's directly above | Put the conclusion FIRST, don't repeat it at the end |
| Explaining what's obvious to someone reading the code | Keep only what only you know |
| Raising an option then immediately dismissing it | Just give the recommendation |
| Hedging, apologising, self-criticism | State plainly what happened |

## Keep — don't cut

- **Conclusions and numbers** — especially measurements, test results, warnings, trade-offs.
- **The reasoning behind a decision** that can't be read off the code.
- **What you're unsure about**, and how unsure.
- **Whole sentences.** Shortening means dropping points that don't change the reader's decision, NOT
  compressing words into fragments, abbreviations, or arrow chains like `A → B → broken`. If the
  reader has to ask again, the saving is gone.
- **Tables when comparing several dimensions** — a table is shorter than the same content as prose.

## Quick check before sending

1. Does the first sentence answer the question, or is it still warming up?
2. Is any passage restating what was just said above?
3. Would the reader decide differently if a passage were removed? If not → remove it.
4. A simple question deserves plain prose — don't build headings and a table of contents for it.

This is NOT terse writing. Readability beats brevity; when the two conflict, choose readability.
