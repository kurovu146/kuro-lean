export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut?: boolean;
  spawnError?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
// After the process exits or is killed, wait this long to flush the remaining buffer before cutting the reader.
const DRAIN_GRACE_MS = 200;

/**
 * Read the stream to the end OR cancel when `stop` resolves (taking whatever arrived).
 * Necessary because an orphaned child (e.g. a forked dev server) can hold the pipe open after the
 * main process is killed → `new Response(stream).text()` would hang forever.
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
    // the reader was cancelled → return what was read
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Run the command with Bun.spawn (NOT through a shell → no injection from kt's side).
 * - try/catch: argv[0] isn't an executable (e.g. the env prefix `FOO=1 cmd`) → return exitCode 127 rather than throwing.
 * - timeout: long-running commands (dev server, --watch) get killed instead of hanging forever; output so far is kept.
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
      stderr: `kt: could not run \`${argv.join(" ")}\`: ${e?.message ?? e}`,
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
