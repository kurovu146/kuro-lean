import { detect } from "../detect";

const COMPLEX_RE = /[|&;><`$]|\$\(/;

export function decideCompress(command: string): string | null {
  const cmd = command.trim();
  if (cmd.startsWith("kt ")) return null;
  if (COMPLEX_RE.test(cmd)) return null;
  if (detect(cmd) === "generic") return null;
  return `kt run -- ${cmd}`;
}
