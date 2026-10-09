#!/bin/bash
# lint.sh — Phase 2: run ESLint and report
# Usage: lint.sh [file ...]   With files, lints only those (the session files).
#
# Prefers the project's own eslint binary: `pnpm lint` in a pnpm@11 repo can
# try to purge and reinstall node_modules under a running dev server.

FILES=()
for f in "$@"; do
  case "$f" in *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) [ -f "$f" ] && FILES+=("$f") ;; esac
done

echo "=== Running ESLint ==="
if [ $# -gt 0 ] && [ ${#FILES[@]} -eq 0 ]; then
  echo "(no lintable files among the ones given)"
  EXIT_CODE=0
elif [ -x node_modules/.bin/eslint ]; then
  node_modules/.bin/eslint "${FILES[@]}" 2>&1
  EXIT_CODE=$?
else
  pnpm lint "${FILES[@]}" 2>&1
  EXIT_CODE=$?
fi

echo ""
echo "=== Lint Exit Code: $EXIT_CODE ==="
exit $EXIT_CODE
