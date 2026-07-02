import type { Profile } from "../detect";
import type { Config } from "../config";
import { type CompressInput, type CompressResult, joinOutput, countLines } from "./types";
import { generic } from "./generic";
import { compressTest } from "./test";
import { compressBuild } from "./build";
import { compressInstall } from "./install";
import { compressGit } from "./git";

export function compress(profile: Profile, input: CompressInput, config: Config): CompressResult {
  const useProfile = config.profiles[profile] ? profile : "generic";
  try {
    switch (useProfile) {
      case "test": return compressTest(input);
      case "build": return compressBuild(input);
      case "lint": return compressBuild(input); // linter cũng chỉ cần giữ error/warning
      case "install": return compressInstall(input);
      case "git": return compressGit(input, config.generic);
      default: return generic(input, config.generic);
    }
  } catch {
    const raw = joinOutput(input);
    return { text: raw, originalLines: countLines(raw), compactLines: countLines(raw), note: "compressor-error-fallback" };
  }
}
