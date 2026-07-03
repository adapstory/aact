#!/usr/bin/env bash
set -euo pipefail

DIFF_RANGE="${1:-HEAD~1..HEAD}"
ROOT="$(git rev-parse --show-toplevel)"

cd "$ROOT"

changed_files="$(mktemp "${TMPDIR:-/tmp}/aact-changed-files.XXXXXX")"
changed_ts_files="$(mktemp "${TMPDIR:-/tmp}/aact-changed-ts-files.XXXXXX")"
trap 'rm -f "$changed_files" "$changed_ts_files"' EXIT

git diff --name-only --diff-filter=ACMR "$DIFF_RANGE" -- \
  | grep -E '\.(ts|js|json|ya?ml|md)$' \
  | grep -vE '^(dist|node_modules)/' \
  >"$changed_files" \
  || true

grep -E '\.(ts|js)$' "$changed_files" >"$changed_ts_files" || true

if [[ -s "$changed_files" ]]; then
  tr '\n' '\0' <"$changed_files" \
    | xargs -0 pnpm exec prettier \
      --ignore-path ./.gitignore \
      --ignore-path ./.prettierignore \
      --check
fi

if [[ -s "$changed_ts_files" ]]; then
  tr '\n' '\0' <"$changed_ts_files" | xargs -0 pnpm exec eslint
fi

pnpm typecheck
pnpm exec vitest run --project unit test/rules/adapstoryBffBoundary.test.ts
pnpm build
