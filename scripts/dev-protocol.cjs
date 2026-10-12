#!/usr/bin/env node
// Creates ~/Applications/Weft Dev.app, a thin wrapper that declares the weft:// URL scheme in
// Info.plist and re-launches the real Electron from node_modules pointing at this project folder.
// Needed because macOS only honours a custom URL scheme if the bundle's Info.plist declares it at
// install time; the dev Electron.app (com.github.Electron) has no CFBundleURLTypes, so the OS
// silently drops weft://account-callback clicks. Re-runs on every `npm run desktop` and is a no-op
// when the wrapper is already current.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const electronApp = path.join(projectRoot, "node_modules", "electron", "dist", "Electron.app");
const wrapperRoot = path.join(os.homedir(), "Applications", "Weft Dev.app");
const bundleId = "com.weft.dev";
const scheme = "weft";

function ensureElectron() {
  if (!fs.existsSync(electronApp)) {
    console.error(`dev-protocol: can't find ${electronApp} — run \`npm install\` first.`);
    process.exit(1);
  }
}

function launcherScript() {
  // Re-launches the real Electron with this project as its app folder, then forwards any
  // weft:// URL that the wrapper received as an extra argv. macOS dispatches the URL to the
  // wrapper as argv[1] when the wrapper is opened from a `weft://` link; --weft-link is the
  // explicit form the wrapper uses when it itself starts the app (so single-instance still
  // forwards the URL to the running instance via the second-instance handler).
  return `#!/bin/bash
set -e
ELECTRON="${electronApp}"
PROJECT="${projectRoot}"
exec "$ELECTRON/Contents/MacOS/Electron" "$PROJECT" --weft-link="$1"
`;
}

function writeInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Weft Dev</string>
  <key>CFBundleDisplayName</key>
  <string>Weft Dev</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
  <key>CFBundleExecutable</key>
  <string>weft-dev</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.0.0</string>
  <key>CFBundleVersion</key>
  <string>0</string>
  <key>LSUIElement</key>
  <false/>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>${bundleId}</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>${scheme}</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
`;
}

function ensureWrapper() {
  const contents = path.join(wrapperRoot, "Contents");
  const macos = path.join(contents, "MacOS");
  const launcher = path.join(macos, "weft-dev");
  fs.mkdirSync(macos, { recursive: true });
  const desired = launcherScript();
  const current = fs.existsSync(launcher) ? fs.readFileSync(launcher, "utf8") : "";
  if (current !== desired) {
    fs.writeFileSync(launcher, desired, { mode: 0o755 });
    console.log("dev-protocol: wrote wrapper launcher");
  }
  const plistPath = path.join(contents, "Info.plist");
  const desiredPlist = writeInfoPlist();
  const currentPlist = fs.existsSync(plistPath) ? fs.readFileSync(plistPath, "utf8") : "";
  if (currentPlist !== desiredPlist) {
    fs.writeFileSync(plistPath, desiredPlist);
    console.log("dev-protocol: wrote wrapper Info.plist");
  }
}

function register() {
  // Re-register with LaunchServices so a fresh Info.plist takes effect.
  const result = spawnSync("/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister", ["-f", wrapperRoot], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error("dev-protocol: lsregister failed; weft:// may not dispatch to the dev build.");
  }
}

function main() {
  ensureElectron();
  ensureWrapper();
  register();
  console.log(`dev-protocol: ready (${wrapperRoot} handles weft://)`);
}

main();
