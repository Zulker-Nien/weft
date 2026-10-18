#!/bin/bash
# push.sh — Phase 4: push the commit, if Weft's "Push on Done" setting is on (the default)
# Usage: push.sh
#
# Reads pushOnDone from Weft's settings.json (WEFT_DATA, else ~/.weft); a missing file or
# key means on. Pushes the current branch with a plain `git push`, never --force. A branch with no
# upstream yet goes to origin with -u.
#
# Exit 0: pushed, or skipped on purpose (setting off, no remote, detached HEAD, nothing to push).
# Exit 1: the push failed (rejected, offline, auth): the commit stays local and the card goes to Review.

SETTINGS="${WEFT_DATA:-$HOME/.weft}/settings.json"
if [ -f "$SETTINGS" ] && grep -Eq '"pushOnDone"[[:space:]]*:[[:space:]]*false' "$SETTINGS"; then
  echo "Push on Done is off in Weft's Settings: not pushing."
  exit 0
fi

BRANCH=$(git symbolic-ref --quiet --short HEAD)
if [ -z "$BRANCH" ]; then
  echo "Detached HEAD: not pushing."
  exit 0
fi

UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
if [ -z "$UPSTREAM" ]; then
  if ! git remote get-url origin >/dev/null 2>&1; then
    echo "$BRANCH has no upstream and there's no origin remote: not pushing."
    exit 0
  fi
  echo "=== Pushing $BRANCH to origin (sets its upstream) ==="
  git push -u origin "$BRANCH" || exit 1
  exit 0
fi

AHEAD=$(git rev-list --count '@{u}..HEAD')
if [ "$AHEAD" = "0" ]; then
  echo "Nothing to push: $BRANCH matches $UPSTREAM."
  exit 0
fi

echo "=== Pushing $AHEAD commit(s) on $BRANCH to $UPSTREAM ==="
git push || exit 1
