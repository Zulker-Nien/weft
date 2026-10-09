#!/bin/bash
# tests.sh — Phase 4: run the tests that cover the session
# Usage: tests.sh [file ...]   With files and vitest, runs only the tests related
#                              to them (vitest related). Otherwise the whole suite.
#
# Prefers the project's own vitest binary: `pnpm test` in a pnpm@11 repo can
# try to purge and reinstall node_modules under a running dev server.

FILES=()
for f in "$@"; do [ -f "$f" ] && FILES+=("$f"); done

echo "=== Running Tests ==="
if [ -x node_modules/.bin/vitest ] && [ ${#FILES[@]} -gt 0 ]; then
  node_modules/.bin/vitest related --run "${FILES[@]}" 2>&1
  EXIT_CODE=$?
elif [ -x node_modules/.bin/vitest ]; then
  node_modules/.bin/vitest run 2>&1
  EXIT_CODE=$?
else
  pnpm test 2>&1
  EXIT_CODE=$?
fi

echo ""
echo "=== Test Exit Code: $EXIT_CODE ==="
exit $EXIT_CODE
