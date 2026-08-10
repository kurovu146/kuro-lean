#!/usr/bin/env bun
import { runAndCompress } from "./pipeline";
import { renderStatusline, collectExtras, type StatuslineInput } from "./statusline";
import { showRun, readMeta } from "./store";
import { renderStats } from "./stats";
import { renderCost, collectUsage, transcriptDir } from "./cost";
import { handoffPrompt } from "./handoff";
import { acquireLock, readWeekly, refreshWeekly, releaseLock, weeklyCachePath, weeklyLockPath } from "./weekly";
import { decideCompress } from "./hooks/compress";
import { decideGuard, checkNoisyRead } from "./hooks/guard";
import { loadConfig } from "./config";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/** Below this, a session has nothing worth rescuing yet - keep it out of the picker. */
const MIN_SESSION_BYTES = 20_000;

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function timestampId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const [cmd, ...rest] = Bun.argv.slice(2);
  const config = loadConfig();

  switch (cmd) {
    case "run": {
      // kt run -- <command...>
      const argv = rest[0] === "--" ? rest.slice(1) : rest;
      if (argv.length === 0) {
        process.stderr.write("kt run -- <command>\n");
        process.exit(1);
      }
      if (process.env.KT_RAW === "1") {
        const proc = Bun.spawn(argv, { stdout: "inherit", stderr: "inherit" });
        process.exit(await proc.exited);
      }
      const { compact, exitCode } = await runAndCompress(argv, config, timestampId);
      process.stdout.write(compact + "\n");
      process.exit(exitCode);
    }
    case "status": {
      const input = JSON.parse((await readStdin()) || "{}") as StatuslineInput;
      process.stdout.write(
        renderStatusline(input, config.statusline, collectExtras(input, config.pricing)),
      );
      return;
    }
    case "handoff": {
      const { clipboardCommand, LIST_LIMIT, listSessions, parseHandoffArgs, renderSessions, resolveFrom } =
        await import("./sessions");
      const args = parseHandoffArgs(rest);
      const projectsRoot = join(homedir(), ".claude", "projects");

      /**
       * `--copy`: the extract exists to be PASTED into a new session, so the last leg should be the
       * clipboard. Writing a file means remembering where it went and opening it to copy - two extra
       * steps at exactly the wrong moment. Report the size so you know something was actually copied.
       */
      const emit = (text: string) => {
        if (args.mode === "list" || !args.copy) {
          process.stdout.write(text);
          return;
        }
        const c = clipboardCommand(process.platform);
        if (!c) {
          process.stderr.write(`kt: no clipboard command known for ${process.platform} - use \`> rescue.md\`\n`);
          process.exit(1);
        }
        try {
          Bun.spawnSync([c.cmd, ...c.args], { stdin: Buffer.from(text) });
        } catch {
          process.stderr.write(`kt: could not run \`${c.cmd}\` - use \`> rescue.md\`\n`);
          process.exit(1);
        }
        process.stderr.write(
          `✓ copied ${text.length.toLocaleString("en-US")} chars (~${Math.round(text.length / 4 / 100) / 10}k tokens) to the clipboard - paste it into a new session\n`,
        );
      };

      // --list: abandoned sessions across the WHOLE MACHINE. Forgetting handoff usually means forgetting
      // which repo the session was in, and --recover follows cwd - without this table there is no way to know.
      if (args.mode === "list") {
        const rows = listSessions(projectsRoot, { minBytes: MIN_SESSION_BYTES, limit: args.limit });
        process.stdout.write(renderSessions(rows, config.pricing));
        if (rows.length) process.stdout.write("\n  → kt handoff --recover --from <#> > rescue.md\n");
        return;
      }

      // --recover: rescue a session whose cache is gone (machine off, left in a hurry). The transcript lives
      // on disk, so it can be read at any time - no cache needed, no resuming the old session.
      if (args.mode === "recover") {
        const { latestTranscript, extractTail, recoverPrompt } = await import("./recover");
        const { readFileSync } = await import("fs");
        // --from: point straight at the session to rescue. Without it, "the newest session of this cwd" is
        // very often the session just opened to run a command, which buries the one that has the work.
        let file: string | null;
        if (args.from) {
          const rows = listSessions(projectsRoot, { minBytes: MIN_SESSION_BYTES, limit: LIST_LIMIT });
          file = resolveFrom(rows, args.from);
          if (!file) {
            process.stderr.write(`kt: could not understand --from ${args.from} (see \`kt handoff --list\`)\n`);
            process.exit(1);
          }
        } else {
          file = latestTranscript(transcriptDir(process.cwd()));
        }
        if (!file || !existsSync(file)) {
          process.stderr.write("kt: no transcript found (try `kt handoff --list`)\n");
          process.exit(1);
        }
        const lines = readFileSync(file, "utf8").split("\n");
        emit(recoverPrompt(extractTail(lines, args.n), file));
        return;
      }

      // Print the prompt to paste into Claude before stopping for the day - it distils the context into a
      // file so the next session starts light instead of resuming a pile of history (see README).
      emit(handoffPrompt(args.file) + "\n");
      return;
    }
    case "cost": {
      // The real bill, derived from usage in the transcripts. Unlike `kt stats` (which only counts compressed
      // chars): most of the money sits in the context cache read/write, not in shell output.
      const dir = transcriptDir(rest[0] || process.cwd());
      process.stdout.write(renderCost(collectUsage(dir), config.pricing));
      return;
    }
    case "weekly": {
      const now = Date.now();
      if (rest.includes("--refresh")) {
        const lock = weeklyLockPath();
        if (!acquireLock(now, lock)) return;   // another refresh already running
        try {
          refreshWeekly(now, { cachePath: weeklyCachePath() }, config.pricing);
        } finally {
          releaseLock(lock);
        }
        return;
      }
      const { line } = readWeekly(now);
      if (line) process.stdout.write(line + "\n");
      return;
    }
    case "hook-compress": {
      let input: any;
      try { input = JSON.parse((await readStdin()) || "{}"); }
      catch { return; }   // malformed stdin → no-op, let the command run normally
      const command: string = input?.tool_input?.command ?? "";
      const next = decideCompress(command);
      if (next) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { command: next } },
        }));
      }
      return;
    }
    case "hook-prompt": {
      if (process.env.KT_DISABLE === "1") return;
      let input: any;
      try { input = JSON.parse((await readStdin()) || "{}"); }
      catch { return; }   // malformed stdin -> no-op, never block a turn unfairly
      const { promptGuardOutput } = await import("./hooks/prompt");
      const out = promptGuardOutput(input, config);
      if (out) process.stdout.write(out);
      return;
    }
    case "hook-guard": {
      if (process.env.KT_DISABLE === "1") return;   // kill switch: disables the guard too
      let input: any;
      try { input = JSON.parse((await readStdin()) || "{}"); }
      catch { return; }   // malformed stdin → no-op, let the command run normally
      let reason: string | null | undefined;
      if (input?.tool_name === "Read") {
        reason = checkNoisyRead(input?.tool_input ?? {}, config.guard);
      } else {
        const command: string = input?.tool_input?.command ?? "";
        const r = decideGuard(command, config.guard);
        reason = r.deny ? r.reason : null;
      }
      if (reason) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
        }));
      }
      return;
    }
    case "show": {
      const out = showRun(rest[0]);
      process.stdout.write(out ?? "(no log)\n");
      return;
    }
    case "stats": {
      process.stdout.write(renderStats(readMeta()));
      return;
    }
    case "init": {
      const { installSettings, installSkill } = await import("./init");
      const { homedir } = await import("os");
      const { join } = await import("path");
      const settingsPath = join(homedir(), ".claude", "settings.json");
      const r = installSettings(settingsPath, "kt");
      process.stdout.write(r.changed ? `✓ installed into ${settingsPath}${r.backup ? ` (backup: ${r.backup})` : ""}\n` : "✓ already installed, nothing changed\n");
      for (const name of ["concise-output", "lean-code"]) {
        try {
          const s = installSkill(join(homedir(), ".claude", "skills"), join(import.meta.dir, "..", "skills", `${name}.md`));
          process.stdout.write(s.changed ? `✓ installed skill ${name}\n` : `✓ skill ${name} already present, nothing changed\n`);
        } catch (e: any) {
          process.stderr.write(`⚠ could not install skill ${name}: ${e?.message ?? e}\n`);
        }
      }
      return;
    }
    case "doctor": {
      const { runDoctor } = await import("./init");
      process.stdout.write(runDoctor());
      return;
    }
    case "bench": {
      const { runBench, parseBenchFlags, realSpawn } = await import("./bench");
      const opts = parseBenchFlags(rest);
      if (!Bun.which("claude")) {
        process.stderr.write("kt bench needs the `claude` CLI on PATH.\n");
        process.exit(1);
      }
      if (!Bun.which("kt")) {
        process.stderr.write("⚠ `kt` is not on PATH - the kt arm will not compress (the hook calls `kt`). Run `bun link` first.\n");
      }
      process.stderr.write(`kt bench: 2 arms x ${opts.runs} runs, model ${opts.model} - runs REAL Claude sessions and spends quota.\n`);
      const report = await runBench(opts, realSpawn, (s) => process.stderr.write(s + "\n"));
      process.stdout.write(report);
      return;
    }
    default:
      process.stdout.write("kt <run|status|stats|cost|weekly|handoff|init|hook-compress|hook-guard|hook-prompt|show|doctor|bench>\n");
  }
}

main().catch((e) => {
  process.stderr.write(`kt: ${e?.message ?? e}\n`);
  process.exit(1);
});
