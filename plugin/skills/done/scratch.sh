#!/bin/bash
# scratch.sh — a private scratch folder for one /weft:done run, outside the project
# Usage: scratch.sh new          → makes <WEFT_DATA or ~/.weft>/done/run-XXXXXX, prints its path
#        scratch.sh clean <dir>  → removes that folder (only a run folder directly under done/)
#
# The batch's prompt files, tasks.json and out/ live here, never in the repo, so they don't land in
# the commit pile and two wrap-ups running at once never share (or overwrite) each other's notes.
# `new` also prunes run folders older than a day that a crashed or interrupted run left behind.

BASE="${WEFT_DATA:-$HOME/.weft}/done"

case "$1" in
  new)
    mkdir -p "$BASE" || exit 1
    find "$BASE" -mindepth 1 -maxdepth 1 -type d -name 'run-*' -mtime +0 -exec rm -rf {} + 2>/dev/null
    DIR=$(mktemp -d "$BASE/run-XXXXXX") || exit 1
    mkdir -p "$DIR/out"
    echo "$DIR"
    ;;
  clean)
    DIR="${2%/}"
    NAME="${DIR#"$BASE"/}"
    case "$NAME" in
      run-*) ;;
      *) NAME="" ;;
    esac
    case "$NAME" in
      ""|*/*|*..*) echo "Not a /weft:done run folder: ${2:-(none)}" >&2; exit 1 ;;
    esac
    rm -rf "${BASE:?}/$NAME"
    ;;
  *)
    echo "Usage: scratch.sh new | scratch.sh clean <dir>" >&2
    exit 2
    ;;
esac
