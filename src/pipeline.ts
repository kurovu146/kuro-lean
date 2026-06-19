import { run } from "./runner";
import { detect } from "./detect";
import { compress } from "./compressors";
import { joinOutput, countLines } from "./compressors/types";
import { saveRun } from "./store";
import type { Config } from "./config";

export async function runAndCompress(
  argv: string[],
  config: Config,
  idFactory: () => string,
): Promise<{ compact: string; exitCode: number }> {
  const res = await run(argv);
  const command = argv.join(" ");
  const input = { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode, command };
  const result = compress(detect(command), input, config);

  const id = idFactory();
  const full = joinOutput(input);
  try {
    saveRun(id, full, { keep: config.store.keepRuns });
  } catch {
    // ghi full thất bại: vẫn in compact
  }
  const saved = countLines(full) - result.compactLines;
  const footer = saved > 0 ? `\n↳ ${saved} dòng đã nén · full: kt show ${id}` : "";
  const header = res.timedOut
    ? `⏱️ lệnh bị kill sau timeout (output có thể chưa đầy đủ — chạy raw nếu cần theo dõi liên tục)\n`
    : "";
  return { compact: header + result.text + footer, exitCode: res.exitCode };
}
