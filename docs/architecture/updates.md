# Releases and updates

Weft ships as a Mac app with everything inside it: the Electron shell, the Next.js server (`Resources/server`) and
the board's UI. Nothing is hosted, so every change, UI or server, reaches people through an app update. The server
reads `~/.weft`, starts Claude Code and terminal shells, and answers only on 127.0.0.1, which a hosted page can't do.

## Cutting a release

1. Bump `version` in `package.json` (and the two lines in `package-lock.json`).
2. In `CHANGELOG.md`, move **Unreleased** under a new `## [X.Y.Z] - date` heading.
3. Commit, tag `vX.Y.Z`, and push the tag.

`.github/workflows/release.yml` runs on the tag, on an Apple silicon runner:

- refuses a tag that doesn't match `package.json`, runs the tests;
- `scripts/release-feed.mjs` writes `dist/update.json` and `dist/release-notes.md` from that version's CHANGELOG section
  (and fails when the section is missing);
- `npm run dist:release` builds the dmg and zip (`Weft-X.Y.Z-arm64.*`), signed with the Developer ID certificate,
  hardened runtime with `build/entitlements.mac.plist`, and notarized;
- checks the signature with `codesign` and Gatekeeper with `spctl`;
- publishes a GitHub release with the dmg, the zip and `update.json`.

Local `npm run dist` stays an unsigned `--dir` build (`CSC_IDENTITY_AUTO_DISCOVERY=false`, so no certificate in your
keychain gets picked up by accident).

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
  installs on the next quit. Restarting asks first when threads are running, since they stop mid-turn.
- Squirrel only installs into a signed app. An unsigned build (or any Squirrel error) falls back to **Download Weft
  X…**, which opens the release page.
- The Weft menu always has the item: **Check for Updates…** says what it found, even "You're up to date".

## Gaps

- Not yet run end to end: the first signed release proves the signing, notarization and Squirrel path.
- arm64 only. Intel Macs would need an `x64` (or `universal`) target and their own zip in the feed.
- No delta updates: each update downloads the full zip.
- `countRunning` in `updater.cjs` repeats the one in `keep-working.cjs`.
