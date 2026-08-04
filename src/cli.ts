#!/usr/bin/env bun
import { runAndCompress } from "./pipeline";
import { renderStatusline, collectExtras, type StatuslineInput } from "./statusline";
import { showRun, readMeta } from "./store";
import { renderStats } from "./stats";
import { renderCost, collectUsage, transcriptDir } from "./cost";
import { handoffPrompt } from "./handoff";
import { decideCompress } from "./hooks/compress";
import { decideGuard, checkNoisyRead } from "./hooks/guard";
import { loadConfig } from "./config";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/** Dưới ngưỡng này phiên chưa kịp có việc gì để cứu — đừng chen vào bảng chọn. */
const MIN_SESSION_BYTES = 20_000;
const LIST_LIMIT = 20;

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
      const { listSessions, parseHandoffArgs, renderSessions, resolveFrom } = await import("./sessions");
      const args = parseHandoffArgs(rest);
      const projectsRoot = join(homedir(), ".claude", "projects");

      // --list: phiên bỏ dở trên TOÀN MÁY. Quên handoff thì thường quên luôn phiên nằm ở repo
      // nào, mà --recover lại bám theo cwd — không có bảng này thì không biết đường mà cd.
      if (args.mode === "list") {
        const rows = listSessions(projectsRoot, { minBytes: MIN_SESSION_BYTES, limit: args.limit });
        process.stdout.write(renderSessions(rows, config.pricing));
        if (rows.length) process.stdout.write("\n  → kt handoff --recover --from <#> > cuu.md\n");
        return;
      }

      // --recover: cứu phiên đã mất cache (máy tắt, về gấp). Transcript nằm trên đĩa nên
      // đọc được bất cứ lúc nào — không cần cache, không cần resume phiên cũ.
      if (args.mode === "recover") {
        const { latestTranscript, extractTail, recoverPrompt } = await import("./recover");
        const { readFileSync } = await import("fs");
        // --from: chỉ thẳng phiên cần cứu. Không có nó thì "phiên gần nhất của cwd" rất dễ là
        // phiên vừa mở để chạy lệnh, và nó che mất đúng phiên có việc.
        let file: string | null;
        if (args.from) {
          const rows = listSessions(projectsRoot, { minBytes: MIN_SESSION_BYTES, limit: LIST_LIMIT });
          file = resolveFrom(rows, args.from);
          if (!file) {
            process.stderr.write(`kt: không hiểu --from ${args.from} (xem \`kt handoff --list\`)\n`);
            process.exit(1);
          }
        } else {
          file = latestTranscript(transcriptDir(process.cwd()));
        }
        if (!file || !existsSync(file)) {
          process.stderr.write("kt: không tìm thấy transcript nào (thử `kt handoff --list`)\n");
          process.exit(1);
        }
        const lines = readFileSync(file, "utf8").split("\n");
        process.stdout.write(recoverPrompt(extractTail(lines, args.n), file));
        return;
      }

      // In prompt để dán vào Claude trước khi nghỉ — chưng cất context xuống file,
      // phiên sau bắt đầu nhẹ thay vì resume cả đống lịch sử (xem README).
      process.stdout.write(handoffPrompt(args.file) + "\n");
      return;
    }
    case "cost": {
      // Hoá đơn thật, quy từ usage trong transcript. Khác `kt stats` (chỉ đếm chars nén được):
      // phần lớn tiền nằm ở cache read/write của context, không ở output shell.
      const dir = transcriptDir(rest[0] || process.cwd());
      process.stdout.write(renderCost(collectUsage(dir), config.pricing));
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
      catch { return; }   // malformed stdin → no-op, đừng chặn oan lượt của user
      const { promptGuardOutput } = await import("./hooks/prompt");
      const out = promptGuardOutput(input, config);
      if (out) process.stdout.write(out);
      return;
    }
    case "hook-guard": {
      if (process.env.KT_DISABLE === "1") return;   // kill-switch: tắt cả guard
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
      process.stdout.write(out ?? "(không có log)\n");
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
      process.stdout.write(r.changed ? `✓ đã cài vào ${settingsPath}${r.backup ? ` (backup: ${r.backup})` : ""}\n` : "✓ đã cài sẵn, không đổi gì\n");
      for (const name of ["concise-output", "lean-code"]) {
        try {
          const s = installSkill(join(homedir(), ".claude", "skills"), join(import.meta.dir, "..", "skills", `${name}.md`));
          process.stdout.write(s.changed ? `✓ đã cài skill ${name}\n` : `✓ skill ${name} đã có, không đổi gì\n`);
        } catch (e: any) {
          process.stderr.write(`⚠ không cài được skill ${name}: ${e?.message ?? e}\n`);
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
        process.stderr.write("kt bench cần `claude` CLI trên PATH.\n");
        process.exit(1);
      }
      if (!Bun.which("kt")) {
        process.stderr.write("⚠ `kt` không có trên PATH — arm kt sẽ không nén (hook gọi `kt`). Chạy `bun link` trước.\n");
      }
      process.stderr.write(`kt bench: 2 arms × ${opts.runs} runs, model ${opts.model} — chạy phiên Claude THẬT, tốn quota.\n`);
      const report = await runBench(opts, realSpawn, (s) => process.stderr.write(s + "\n"));
      process.stdout.write(report);
      return;
    }
    default:
      process.stdout.write("kt <run|status|stats|cost|handoff|init|hook-compress|hook-guard|hook-prompt|show|doctor|bench>\n");
  }
}

main().catch((e) => {
  process.stderr.write(`kt: ${e?.message ?? e}\n`);
  process.exit(1);
});
