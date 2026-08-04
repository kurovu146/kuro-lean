import type { Profile } from "../detect";
import type { Config } from "../config";
import { type CompressInput, type CompressResult, joinOutput, countLines, capChars } from "./types";
import { generic } from "./generic";
import { compressTest } from "./test";
import { compressBuild } from "./build";
import { compressInstall } from "./install";
import { compressGit } from "./git";

export function compress(profile: Profile, input: CompressInput, config: Config): CompressResult {
  const useProfile = config.profiles[profile] ? profile : "generic";
  let result: CompressResult;
  try {
    switch (useProfile) {
      case "test": result = compressTest(input); break;
      case "build": result = compressBuild(input); break;
      case "lint": result = compressBuild(input); break; // a linter likewise only needs errors/warnings kept
      case "install": result = compressInstall(input); break;
      case "git": result = compressGit(input, config.generic); break;
      default: result = generic(input, config.generic);
    }
  } catch {
    const raw = joinOutput(input);
    result = { text: raw, originalLines: countLines(raw), compactLines: countLines(raw), note: "compressor-error-fallback" };
  }
  // The hard character cap — applied to the fallback too, closing the "one giant line" / "a failure keeps everything" holes
  const capped = capChars(result.text, config.limits.maxChars);
  if (capped !== result.text) {
    result = { ...result, text: capped, compactLines: countLines(capped), note: result.note ? `${result.note}+char-cap` : "char-cap" };
  }
  return result;
}
