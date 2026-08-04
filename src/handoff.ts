/**
 * A prompt that distils the session state into a file, so the next session starts at ~5k tokens
 * instead of hauling the old context along. Many times cheaper than resuming, and every later
 * turn stays light too.
 */
export function handoffPrompt(file: string): string {
  return `Write the state of this session to \`${file}\` so the next session can continue WITHOUT re-reading the history.

Follow this exact structure:

## In progress
The goal of this session, and how far it got.

## Done
Completed work + the matching commit/branch (if any). State what was verified, and how.

## Decisions and why
Only decisions that can't be inferred from the code — why this direction over the alternative,
what was tried and failed.

## Unfinished / Next step
The specific next task, detailed enough to start on immediately.

## Files being touched
Paths + line numbers where useful. Do NOT copy file contents in here.

## Traps hit
Things that cost time and are easy to walk into again.

Rules:
- Do NOT copy code, diffs, or command output — paths and line numbers only.
- Do NOT restate what's already in the git log, the README, or code comments.
- Drop any section with nothing in it; don't write "none".
- Write it for yourself a few days from now: enough to act on, not a status report.

When it's written, tell me the path and line count, don't summarise the contents back to me.`;
}
