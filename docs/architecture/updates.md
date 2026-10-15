# Releases and updates

Weft ships as a Mac app with everything inside it: the Electron shell, the Next.js server (`Resources/server`) and
the board's UI. Nothing is hosted, so every change, UI or server, reaches people through an app update. The server
reads `~/.weft`, starts Claude Code and terminal shells, and answers only on 127.0.0.1, which a hosted page can't do.

## What's inside the app

| Where | What | How it gets there |
| --- | --- | --- |
| `Resources/app.asar` | `electron/` and the main process's only packages: `libsodium-wrappers` (the 🔐 vault) and `node-pty` (the terminal; its darwin prebuild unpacked beside the asar so the native module loads) | `build.files` in `package.json`; every other `node_modules` folder stays out |
| `Resources/server` | The Next.js standalone server, run by Weft Helper as Node (`electron/server.cjs`), with only the packages it imports, mostly the Agent SDK's Claude Code binary (~240 MB) | `next build` with `THREADBOARD_STANDALONE=1`, then `scripts/prepare-standalone.mjs` |
| `Resources/toolchain` | The toolchain, below | `scripts/bundle-toolchain.mjs` |
| `Resources/plugin` | Weft's own skills | `extraResources` |

### Toolchain

A fresh Mac has no Node, pnpm, Claude Code or puku, and Weft users should still be able to build Next.js + Supabase
projects. `toolchain/bin` holds `node`, `npm`, `npx`, `pnpm`, `pnpx`, `puku-cli` and `claude`: shell wrappers that run
on Weft Helper with `ELECTRON_RUN_AS_NODE=1` (Electron 44 is Node 24, the same major as Vercel's default), except
`claude`, which runs the Agent SDK's binary from `Resources/server`. `electron/main.cjs` appends the folder to the
**end** of PATH after `fixPath()` (`appendToolchain()` in `electron/env.cjs`), so threads, the terminal drawer, dev
servers and `which claude` / `which puku-cli` (login, puku threads) find them, and a Mac's own tools always win.

`scripts/bundle-toolchain.mjs` pins npm, pnpm and `@puku/puku-cli` (from the registry) and prunes puku: ripgrep and
sharp for other platforms, `better-sqlite3` (puku uses `node:sqlite`; the prebuilt binding has Node's ABI, not
Electron's), and its telemetry: OpenTelemetry goes, `@sentry/node` becomes a no-op stub. 426 → 196 MB, ~230 MB for
the whole toolchain. Not shipped: git (macOS offers the Command Line Tools on first use), gh, Docker, Homebrew;
`npx supabase` and `npx vercel` fetch those CLIs per project.

Verified on Electron's Node with nothing else on PATH: `create-next-app` (npm and pnpm), `next build` with Turbopack,
`@supabase/supabase-js`, `supabase` and `vercel` through npx / pnpm dlx, and a puku thread through the Agent SDK with a
tool call.

## Cutting a release

1. Bump `version` in `package.json`.
2. In `CHANGELOG.md`, move **Unreleased** under a new `## [X.Y.Z] - date` heading.
3. Commit, tag `vX.Y.Z`, and push the tag.

`.github/workflows/release.yml` runs on the tag, on an Apple silicon runner:

- refuses a tag that doesn't match `package.json`, runs the tests;
- `scripts/release-feed.mjs` writes `dist/update.json` and `dist/release-notes.md` from that version's CHANGELOG section
  (and fails when the section is missing);
- `pnpm dist:release` builds the dmg and zip (`Weft-X.Y.Z-arm64.*`), signed with the Developer ID certificate,
  hardened runtime with `build/entitlements.mac.plist`, and notarized;
- checks the signature with `codesign` and Gatekeeper with `spctl`;
- publishes a GitHub release with the dmg, the zip and `update.json`.

Local `pnpm dist` stays an unsigned `--dir` build (`CSC_IDENTITY_AUTO_DISCOVERY=false`, so no certificate in your
keychain gets picked up by accident). A local signed dmg is `NODE_ENV=production pnpm dist:release`: it signs with
the Developer ID in your keychain and skips notarization without the `APPLE_API_*` variables, so Gatekeeper on
another Mac asks before the first open.

### Secrets

| Secret | What |
| --- | --- |
| `MAC_CERT_P12_BASE64` | The "Developer ID Application" certificate and its key, exported as .p12, base64'd |
| `MAC_CERT_PASSWORD` | The .p12's export password |
| `APPLE_API_KEY_P8` | An App Store Connect API key (.p8 file contents), for notarization |
| `APPLE_API_KEY_ID` | That key's ID |
| `APPLE_API_ISSUER` | The issuer ID shown above the keys list |

The certificate belongs to the Apple Developer team that publishes Weft; Gatekeeper shows its name. Weft publishes
from Alex Miller's individual membership, not Flexbike Inc's.

## How an installed Weft updates (`electron/updater.cjs`)

- A packaged Weft fetches `https://github.com/aimhuge/weft/releases/latest/download/update.json` 30s after launch and
  every 4 hours (`WEFT_UPDATE_FEED` overrides it). Dev mode never checks on its own; it updates with `git pull`.
- `update.json` is Squirrel.Mac's static JSON feed (`currentRelease`, `releases[].updateTo.url` → the zip), plus
  `page` and `download` for the fallback.
- When the feed's version is newer, the feed goes to Electron's built-in `autoUpdater` (Squirrel.Mac), which downloads
  the zip in the background. No npm dependency: the app bundle ships no `node_modules`.
- Once downloaded: a notification, and the Weft menu's item becomes **Restart to Update to X**. The update also
  installs on the next quit. With threads running, restarting asks first: **Restart When Idle** (the default) arms the
  server's drain (`lib/restart-when-idle.ts`) with `then: "update"`, and once the last turn ends the server calls the
  control server's `POST /app/restart`, which runs `updater.installNow()`; **Restart Now** installs at once.
- Squirrel only installs into a signed app. An unsigned build (or any Squirrel error) falls back to **Download Weft
  X…**, which opens the release page.
- The Weft menu always has the item: **Check for Updates…** says what it found, even "You're up to date".

## Gaps

- Not yet run end to end: the first signed release proves the signing, notarization and Squirrel path.
- arm64 only. Intel Macs would need an `x64` (or `universal`) target and their own zip in the feed.
- No delta updates: each update downloads the full zip.
- `countRunning` in `updater.cjs` repeats the one in `keep-working.cjs`.
- The toolchain's versions are pinned in `scripts/bundle-toolchain.mjs` and move only when someone bumps them.
- A puku trial for people without a Puku account (Weft's key behind the deployed Weft) is its own card; until it
  lands, a puku thread needs `puku-cli auth login`.
