#!/bin/bash
# audit.sh — read-only audit of a project for /done readiness. Changes nothing.
# Usage: audit.sh [project-dir]   (default: current dir)
# Output: one line per check, "area|check|status|detail", then a table.
# status is OK, WEAK or MISSING.

cd "${1:-.}" || exit 1
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
DONE_DIR="$SKILL_DIR/../done"
ROWS=()
row() { ROWS+=("$1|$2|$3|$4"); }

has_pkg() { [ -f package.json ]; }
pkg_has() { has_pkg && grep -q "\"$1\"" package.json; }
script_has() { has_pkg && node -e "process.exit((require('./package.json').scripts||{})['$1']?0:1)" 2>/dev/null; }

# Stack
STACK=unknown
if has_pkg; then
  STACK=node
  { pkg_has typescript || [ -f tsconfig.json ]; } && STACK=ts
elif [ -f pyproject.toml ] || [ -f requirements.txt ] || [ -f setup.py ]; then STACK=python
fi
PM=npm
[ -f pnpm-lock.yaml ] && PM=pnpm
[ -f yarn.lock ] && PM=yarn
[ -f bun.lockb ] || [ -f bun.lock ] && PM=bun
echo "stack=$STACK pm=$PM"

# Testing
if [ "$STACK" = python ]; then
  if grep -qs pytest pyproject.toml requirements*.txt 2>/dev/null || [ -f pytest.ini ]; then row Testing runner OK pytest; else row Testing runner MISSING "no pytest"; fi
  if grep -qs pytest-cov pyproject.toml requirements*.txt 2>/dev/null; then row Testing coverage OK pytest-cov; else row Testing coverage MISSING "no pytest-cov"; fi
  n=$(find . -name 'test_*.py' -not -path './node_modules/*' -not -path './.venv/*' 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] && row Testing "test files" OK "$n" || row Testing "test files" MISSING none
elif has_pkg; then
  if pkg_has vitest || pkg_has jest; then row Testing runner OK "$(pkg_has vitest && echo vitest || echo jest)"; else row Testing runner MISSING "no vitest/jest"; fi
  script_has test && row Testing "test script" OK present || row Testing "test script" MISSING "no scripts.test"
  script_has coverage && row Testing "coverage script" OK present || row Testing "coverage script" MISSING "no scripts.coverage"
  n=$(find . \( -name '*.test.*' -o -name '*.spec.*' \) -not -path '*/node_modules/*' -not -path './.next/*' 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] && row Testing "test files" OK "$n" || row Testing "test files" MISSING none
else
  row Testing runner MISSING "unknown stack"
fi

# Docs
for d in docs/architecture docs/bug-fixes; do
  if [ -d "$d" ]; then c=$(ls "$d" | grep -vc '^\.gitkeep$'); [ "$c" -gt 0 ] && row Docs "$d" OK "$c files" || row Docs "$d" WEAK "empty"
  else row Docs "$d" MISSING ""; fi
done
[ -f docs/file-sizes.md ] && row Docs docs/file-sizes.md OK present || row Docs docs/file-sizes.md MISSING ""
[ -f SOUL.md ] && row Docs SOUL.md OK present || row Docs SOUL.md MISSING ""
if [ -f CLAUDE.md ]; then grep -q '@SOUL.md' CLAUDE.md && row Docs CLAUDE.md OK "includes SOUL.md" || row Docs CLAUDE.md WEAK "exists, no @SOUL.md include"
else row Docs CLAUDE.md MISSING ""; fi

# Lint
if has_pkg; then
  script_has lint && row Lint "lint script" OK "$(node -p "require('./package.json').scripts.lint")" || row Lint "lint script" MISSING ""
  cfg=$(ls eslint.config.* .eslintrc* 2>/dev/null | head -1)
  if [ -z "$cfg" ]; then row Lint "eslint config" MISSING ""
  elif grep -qs 'strict' "$cfg" && grep -qs 'no-explicit-any\|strictTypeChecked\|tseslint.configs.strict' "$cfg"; then row Lint "eslint config" OK "$cfg (strict)"
  else row Lint "eslint config" WEAK "$cfg (not strict)"; fi
  for r in complexity max-lines no-unused-vars no-explicit-any; do
    [ -n "$cfg" ] && grep -qs "$r" "$cfg" && row Lint "rule $r" OK "" || row Lint "rule $r" MISSING ""
  done
  if [ -f tsconfig.json ]; then grep -Eq '"strict"[[:space:]]*:[[:space:]]*true' tsconfig.json && row Lint "tsc strict" OK "" || row Lint "tsc strict" WEAK "strict not true"; fi
elif [ "$STACK" = python ]; then
  grep -qs 'ruff' pyproject.toml && row Lint ruff OK "" || row Lint ruff MISSING ""
fi

# Helper scripts /done relies on
for s in lint.sh tests.sh file-sizes.sh; do
  if [ -x "$DONE_DIR/$s" ] || [ -f "$DONE_DIR/$s" ]; then row Scripts "$s" OK "$DONE_DIR"
  elif [ -f ".claude/skills/done/$s" ]; then row Scripts "$s" OK ".claude/skills/done"
  else row Scripts "$s" MISSING "not beside /done"; fi
done

printf "\n%-9s %-22s %-8s %s\n" AREA CHECK STATUS DETAIL
for r in "${ROWS[@]}"; do IFS='|' read -r a c s d <<<"$r"; printf "%-9s %-22s %-8s %s\n" "$a" "$c" "$s" "$d"; done
