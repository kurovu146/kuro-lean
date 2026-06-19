export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export async function run(argv: string[]): Promise<RunResult> {
  const start = performance.now();
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode, durationMs: performance.now() - start };
}
