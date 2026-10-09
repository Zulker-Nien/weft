#!/bin/bash
# commit.sh — Phase 5: stage and commit
# Usage: commit.sh "commit message" [file1 file2 ...]
# First argument is the commit message, remaining are files to stage
#
# The commit takes ONLY these paths (`git commit -- <paths>`), never the whole
# index. Sessions that share a working tree share its index, so a bare
# `git commit` would also take whatever another session staged a second ago.
# `git add` still runs first: a pathspec commit can't see a brand-new file
# until it is tracked. A tracked path that is gone from disk is committed as
# a deletion; a path git has never seen fails the whole commit.

if [ $# -lt 1 ]; then
  echo "Usage: commit.sh \"commit message\" [file1 file2 ...]"
  exit 1
fi

MESSAGE="$1"
shift

echo "=== Staging Files ==="
if [ $# -gt 0 ]; then
  for f in "$@"; do
    if [ -e "$f" ]; then
      git add "$f"
      echo "  staged: $f"
    else
      echo "  not on disk: $f (committed as a deletion if tracked)"
    fi
  done
else
  echo "No files specified to stage"
  exit 1
fi

echo ""
echo "=== Committing (only the paths above) ==="
git commit -m "$MESSAGE" -- "$@"
EXIT_CODE=$?

echo ""
echo "=== Post-Commit Status ==="
git status --short

exit $EXIT_CODE
