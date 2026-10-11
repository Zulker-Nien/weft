#!/bin/bash
# Type-checks and lints exactly what's staged, not the working tree: a commit can't import a file that
# exists on disk but was never added. Runs on a copy of the index, so it never stashes or touches
# other threads' unstaged work in the shared tree. Skip once with `git commit --no-verify`.
set -u
root="$(git rev-parse --show-toplevel)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/weft-staged.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

git -C "$root" checkout-index --all --prefix="$tmp/"
ln -s "$root/node_modules" "$tmp/node_modules"
cd "$tmp" || exit 1

npx --no-install next typegen > /dev/null 2>&1
if ! npx --no-install tsc --noEmit > "$tmp/tsc.log" 2>&1; then
  echo "pre-commit: the staged files don't type-check on their own:" >&2
  grep "error TS" "$tmp/tsc.log" | head -20 >&2
  echo "Usually a file it imports isn't staged: check 'git status' for untracked files." >&2
  exit 1
fi

# Lint the staged versions of the changed files, with the same rules as `npm run lint`.
git -C "$root" diff --cached --name-only --diff-filter=ACMR -z -- '*.ts' '*.tsx' '*.mts' '*.cjs' '*.mjs' > "$tmp/.staged"
if [ -s "$tmp/.staged" ]; then
  if ! xargs -0 npx --no-install eslint --max-warnings 0 --no-warn-ignored < "$tmp/.staged" > "$tmp/eslint.log" 2>&1; then
    echo "pre-commit: the staged files don't pass lint:" >&2
    head -40 "$tmp/eslint.log" >&2
    exit 1
  fi
fi
