#!/usr/bin/env bun
import { runAndCompress } from "./pipeline";
import { renderStatusline, collectExtras, type StatuslineInput } from "./statusline";
import { showRun } from "./store";
import { decideCompress } from "./hooks/compress";
import { decideGuard } from "./hooks/guard";
import { loadConfig } from "./config";

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
      process.stdout.write(renderStatusline(input, config.statusline, collectExtras(input)));
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
    case "hook-guard": {
      let input: any;
      try { input = JSON.parse((await readStdin()) || "{}"); }
      catch { return; }   // malformed stdin → no-op, let the command run normally
      const command: string = input?.tool_input?.command ?? "";
      const { deny, reason } = decideGuard(command, config.guard);
      if (deny) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
        }));
      }
      return;
    }
    case "show": {
      const out = showRun(rest[0]);
      process.stdout.write(out ?? "(không có log)\n");
      return;
    }
    case "init": {
      const { installSettings } = await import("./init");
      const { homedir } = await import("os");
      const { join } = await import("path");
      const settingsPath = join(homedir(), ".claude", "settings.json");
      const r = installSettings(settingsPath, "kt");
      process.stdout.write(r.changed ? `✓ đã cài vào ${settingsPath}${r.backup ? ` (backup: ${r.backup})` : ""}\n` : "✓ đã cài sẵn, không đổi gì\n");
      return;
    }
    case "doctor": {
      const { runDoctor } = await import("./init");
      process.stdout.write(runDoctor());
      return;
    }
    default:
      process.stdout.write("kt <run|status|init|hook-compress|hook-guard|show|doctor>\n");
  }
}

main();
