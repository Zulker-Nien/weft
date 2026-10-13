# 013: weft:// wasn't registered in dev, so sign-in did nothing

- **Date:** 2026-10-13
- **Severity:** High (the OAuth flow was completely blocked in dev: clicking the GitHub
  authorize button on Supabase's page did nothing on the Weft side, and the user had no signal
  that the click was being dropped)

## Symptom

In `npm run desktop` (the dev Electron), clicking **Sign in → GitHub** opened Supabase's
authorize page in the system browser, the user clicked **Authorize** on GitHub, and
Supabase redirected to `weft://account-callback?code=…`. The browser then showed a blank
page; nothing happened on the Weft side. The board's `useAccount` polling never picked up
a session, and the user had no way to know the link was being dropped by the OS.

In a packaged build (`npm run dist`) the same flow worked, which made the dev/build split
look like the bug.

## Root cause

macOS only honors a custom URL scheme if the receiving app's `Info.plist` declares it
via `CFBundleURLTypes`, and the scheme is then bound to that bundle through LaunchServices.
The packaged `Weft.app` gets that declaration from electron-builder's `protocols: [{ name:
"Weft", schemes: ["weft"] }]` in `package.json`, plus `app.setAsDefaultProtocolClient("weft")`
in `electron/main.cjs`. The dev Electron, though, is `node_modules/electron/dist/Electron.app`
(bundle id `com.github.Electron`) — a generic shell that ships with **no** `CFBundleURLTypes`.
When Supabase redirected to `weft://account-callback`, macOS looked the scheme up, found
no registered handler, and silently dropped the click. There was no prompt, no error, and
no log line on the Weft side.

The `weft://` scheme itself is correct (and is documented in `docs/architecture/account.md`):
the scheme is permanent across dev-server port changes, which `http://127.0.0.1:PORT/...`
couldn't be. The bug was that the dev path had no app to receive it.

## Fix

A thin wrapper app at `~/Applications/Weft Dev.app` (`com.weft.dev`) whose `Info.plist`
declares `weft` in `CFBundleURLTypes`. Its launcher script execs the real dev Electron with
this project as its app folder and the received URL as a `--weft-link=weft://…` arg, so
the running dev Electron sees the link in its argv. The Electron main's `second-instance`
handler pulls the link out with `argvLink()` and dispatches it to the existing
`handleLink()` path.

- `scripts/dev-protocol.cjs` (run by `npm run desktop` before Electron starts, and
  standalone as `npm run dev:protocol`):
  - Writes `~/Applications/Weft Dev.app/Contents/Info.plist` with the
    `CFBundleURLTypes` block declaring `weft`.
  - Writes `~/Applications/Weft Dev.app/Contents/MacOS/weft-dev`, a bash launcher that
    execs `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <project>
    --weft-link="$1"`.
  - Idempotent: re-runs on every `npm run desktop`, skips the write when the file already
    matches.
  - Calls `lsregister -f <wrapper>` so a fresh `Info.plist` is picked up by
    LaunchServices.
- `electron/argv-link.cjs` — `argvLink(argv, protocol = "weft")`:
  - Returns the first argv entry that starts with `weft://` (the wrapper's default
    form).
  - Also accepts the explicit `--weft-link=weft://…` form, for any script that
    wants to be obvious about the intent.
  - Prefers a raw `weft://…` arg over the explicit form when both are present.
  - Returns `null` for any argv without a link.
- `electron/argv-link.test.ts` — five tests covering the raw form, the explicit form,
  the preference order, the `null` cases, and the rejection of non-`weft://` URLs and
  malformed `--weft-link` values.
- `electron/main.cjs` — `app.on("second-instance", …)` now calls `argvLink(argv,
  PROTOCOL)` and hands the result to the existing `handleLink()`. The macOS `open-url`
  path is unchanged.
- `package.json` — `npm run desktop` runs `dev-protocol.cjs` before launching Electron.
  A standalone `npm run dev:protocol` script runs it on its own (handy after editing
  the wrapper or when an old wrapper is still on disk).

The dev flow is now end-to-end: Supabase → `weft://account-callback` → wrapper at
`~/Applications/Weft Dev.app` → execs dev Electron with `--weft-link=…` → `argvLink`
parses it → `handleLink` dispatches it → `accountLink.handle()` POSTs the code to
`/api/account/weft-callback` and the session is exchanged. No regression on packaged
builds, which still use `app.setAsDefaultProtocolClient("weft")` directly.

## Key rule

A custom URL scheme is bound to a bundle, not to a process. In dev, the dev Electron
is a generic shell that doesn't own the scheme, so the OS needs an app — any app —
that does. The wrapper is that app, and it forwards to the dev Electron by argv.
In packaged builds, the app is `Weft.app` itself, and the same argv-parsing code
in `second-instance` covers the cross-platform path that `open-url` doesn't.

## Files involved

- `scripts/dev-protocol.cjs` (new) — builds the wrapper app and `lsregister`s it.
- `electron/argv-link.cjs` (new) — parses the link out of argv.
- `electron/argv-link.test.ts` (new) — five tests.
- `electron/main.cjs` — `second-instance` handler now uses `argvLink()`.
- `package.json` — `npm run desktop` runs `dev-protocol` first; new `dev:protocol`
  script.
- `docs/architecture/account.md` — documents the redirect target, the wrapper, and
  the argv-link mechanism.
