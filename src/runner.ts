export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut?: boolean;
  spawnError?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
// Sau khi process exit/bị kill, chờ chừng này để flush nốt buffer rồi mới cắt reader.
const DRAIN_GRACE_MS = 200;

/**
 * Đọc stream tới khi hết HOẶC tới khi `stop` resolve thì hủy (lấy phần đã có).
 * Cần thiết vì process con orphan (vd dev server fork) có thể giữ pipe mở sau khi
 * process chính bị kill → `new Response(stream).text()` sẽ treo vô hạn.
 */
async function drain(stream: ReadableStream<Uint8Array> | null, stop: Promise<void>): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  stop.then(() => reader.cancel().catch(() => {}));
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } catch {
    // reader bị cancel → trả phần đã đọc
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Chạy lệnh bằng Bun.spawn (KHÔNG qua shell → không injection từ phía kt).
 * - try/catch: argv[0] không phải executable (vd env-prefix `FOO=1 cmd`) → trả exitCode 127 thay vì throw.
 * - timeout: lệnh long-running (dev server, --watch) bị kill thay vì treo vô hạn; output đã có vẫn giữ.
 */
export async function run(argv: string[], timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<RunResult> {
  const start = performance.now();
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(argv, {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      timeout: timeoutMs,
      killSignal: "SIGTERM",
    });
  } catch (e: any) {
    return {
      stdout: "",
      stderr: `kt: không chạy được lệnh \`${argv.join(" ")}\`: ${e?.message ?? e}`,
      exitCode: 127,
      durationMs: performance.now() - start,
      spawnError: String(e?.code ?? e?.message ?? e),
    };
  }
  const stop = proc.exited.then(() => new Promise<void>((r) => setTimeout(r, DRAIN_GRACE_MS)));
  const [stdout, stderr] = await Promise.all([
    drain(proc.stdout as ReadableStream<Uint8Array>, stop),
    drain(proc.stderr as ReadableStream<Uint8Array>, stop),
  ]);
  const exitCode = await proc.exited;
  const timedOut = proc.killed && proc.signalCode === "SIGTERM";
  return { stdout, stderr, exitCode, durationMs: performance.now() - start, timedOut };
}
