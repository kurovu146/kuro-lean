#!/usr/bin/env bash
# Measure the real token savings of kt on actual dev commands.
# Token estimate ~ chars/4 (a tokenizer approximation). Raw output vs output compressed by `kt run`.
set -uo pipefail
cd "$(dirname "$0")/.."

KT="kt"
if ! command -v kt >/dev/null 2>&1; then KT="bun run $PWD/src/cli.ts"; fi

chars() { printf '%s' "$1" | wc -c | tr -d ' '; }
lines() { printf '%s\n' "$1" | wc -l | tr -d ' '; }

printf "| %-26s | %8s | %8s | %8s | %6s |\n" "Command" "raw ch" "kt ch" "saved" "ratio"
printf "|%s|%s|%s|%s|%s|\n" "----------------------------" "----------" "----------" "----------" "--------"

run_case() {
  local label="$1"; shift
  local raw comp rc cc saved ratio
  raw="$("$@" 2>&1)"
  comp="$($KT run -- "$@" 2>&1)"
  rc=$(chars "$raw"); cc=$(chars "$comp")
  saved=$((rc - cc))
  ratio="-"
  [ "$rc" -gt 0 ] && ratio=$(awk "BEGIN{printf \"%.0f%%\", ($saved/$rc)*100}")
  printf "| %-26s | %8s | %8s | %8s | %6s |\n" "$label" "$rc" "$cc" "$saved" "$ratio"
}

run_case "bun test"            bun test
run_case "git diff HEAD~10"    git diff HEAD~10 HEAD
run_case "git log --oneline"   git log --oneline -20
run_case "git status"          git status
