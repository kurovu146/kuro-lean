import { run } from "./runner";
import { detect } from "./detect";
import { compress } from "./compressors";
import { joinOutput, countLines } from "./compressors/types";
import { saveRun, appendMeta } from "./store";
import type { Config } from "./config";

export async function runAndCompress(
  argv: string[],
  config: Config,
  idFactory: () => string,
  storeRoot?: string,
): Promise<{ compact: string; exitCode: number }> {
  const res = await run(argv, config.run.timeoutMs);
  const command = argv.join(" ");
  const input = { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode, command };
  const full = joinOutput(input);
  const header = res.timedOut
    ? `⏱️ command killed after the timeout (output may be incomplete — run it raw if you need to watch it live)\n`
    : "";
  // Pass small output straight through: verbatim, no store/meta — the model sees familiar output and
  // spends no turn verifying it; kt only compresses where the saving is real.
  if (full.length < config.run.rawUnderChars) {
    return { compact: header + full, exitCode: res.exitCode };
  }
  const profile = detect(command);
  const result = compress(profile, input, config);

  const id = idFactory();
  try {
    saveRun(id, full, { keep: config.store.keepRuns, root: storeRoot });
    appendMeta(
      { id, command, profile, originalChars: full.length, compactChars: result.text.length },
      { root: storeRoot },
    );
  } catch {
    // writing full/meta failed: still print the compact form
  }
  const saved = countLines(full) - result.compactLines;
  const footer = saved > 0 ? `\n↳ ${saved} lines compressed · full: kt show ${id}` : "";
  return { compact: header + result.text + footer, exitCode: res.exitCode };
}
