# 019: "Error launching app … EPERM" when the checkout is in Desktop

- **Date:** 2026-10-17
- **Severity:** Medium (Weft wouldn't start whenever macOS, not Terminal, launched it)

## Symptom

A user with the checkout at `~/Desktop/Projects/weft` saw an Electron dialog, "Error launching
app: Unable to parse …/package.json — EPERM: operation not permitted, open …/package.json",
while the board from an earlier launch was still on screen. `pnpm desktop` from Terminal worked.

## Root cause

macOS privacy (TCC) guards Desktop, Documents and Downloads per app. Started from Terminal,
Electron borrows Terminal's permission. Started by macOS (a `weft://` link through
`~/Applications/Weft Dev.app`, or `app.relaunch()`), Electron is judged on its own, has no
grant, can't open `package.json`, and shows its default error before any Weft code runs.

## Fix

`scripts/dev-protocol.cjs`:

- `warnIfProtected()` prints a warning from `pnpm desktop` when the checkout sits in one of
  those folders, with the `mv` command to fix it.
- The wrapper's `weft-dev` script first reads `package.json` (`head -c1`; `test -r` doesn't
  trip TCC) and, if it can't, shows an `osascript` alert saying to move the folder or allow
  Weft Dev and Electron under Privacy & Security → Files and Folders.

**Key rule:** keep the checkout outside Desktop, Documents and Downloads; macOS-launched
processes don't inherit Terminal's folder permissions.

## Files

`scripts/dev-protocol.cjs`, `scripts/dev-protocol.test.ts`
