export type Profile = "test" | "build" | "install" | "git" | "lint" | "generic";

const PATTERNS: [Profile, RegExp][] = [
  ["test", /\b(jest|vitest|bun test|go test|cargo test|pytest|(npm|pnpm|yarn|bun) (run )?test)\b/],
  ["build", /\b(tsc|cargo build|webpack|vite build|next build|go build|(npm|pnpm|yarn|bun) (run )?build)\b/],
  ["lint", /\b(eslint|golangci-lint|(npm|pnpm|yarn|bun) (run )?lint)\b/],
  ["install", /\b((npm|pnpm) (i|install|add)|yarn (add|install)|bun (i|install|add))\b/],
  ["git", /\bgit (status|diff|log)\b/],
];

export function detect(command: string): Profile {
  for (const [profile, re] of PATTERNS) {
    if (re.test(command)) return profile;
  }
  return "generic";
}
