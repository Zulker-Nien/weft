// Package-manager channels for a release, built from its artifacts. Nothing here runs in CI yet: we aren't
// publishing to brew or apt, this is the machinery for when we do (docs/architecture/updates.md, "Channels").
//   node scripts/release-channels.mjs cask <version> [dmgPath] [outDir]   → <outDir>/weft.rb, the Homebrew cask
//   node scripts/release-channels.mjs apt  <debDir> [outDir]              → <outDir>/ a flat apt repo for the .deb files in debDir
// The cask goes in a tap repo (aimhuge/homebrew-weft, Casks/weft.rb); the apt tree goes on any static host.
// apt signs Release with $WEFT_APT_GPG_KEY (a key id) when set; unsigned otherwise.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assetName } from "./release-feed.mjs";

const REPO = "https://github.com/aimhuge/weft";

export const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function caskFor(version, sha) {
  return `cask "weft" do
  version "${version}"
  sha256 "${sha}"

  url "${REPO}/releases/download/v#{version}/Weft-#{version}-arm64.dmg"
  name "Weft"
  desc "Kanban board where every card is a Claude Code, puku-cli or Codex thread"
  homepage "https://weft.zip"

  depends_on arch: :arm64
  depends_on macos: ">= :ventura"

  app "Weft.app"

  zap trash: [
    "~/.weft",
    "~/Library/Application Support/Weft",
  ]
end
`;
}

function writeCask(version, dmg, outDir) {
  const file = path.resolve(dmg || `dist/${assetName(version, "dmg")}`);
  if (!fs.existsSync(file)) throw new Error(`${file} is missing. Build the release first.`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "weft.rb"), caskFor(version, sha256(file)));
  console.log(`Wrote ${path.join(outDir, "weft.rb")} for ${version}`);
}

// A flat repo: the .debs, Packages(.gz) and Release from apt-ftparchive (apt-utils), InRelease signed by gpg.
function writeApt(debDir, outDir) {
  const debs = fs.readdirSync(debDir).filter((name) => name.endsWith(".deb"));
  if (debs.length === 0) throw new Error(`No .deb files in ${debDir}.`);
  fs.mkdirSync(outDir, { recursive: true });
  for (const deb of debs) fs.copyFileSync(path.join(debDir, deb), path.join(outDir, deb));
  const ftp = (args) => execFileSync("apt-ftparchive", args, { cwd: outDir, encoding: "utf8" });
  const packages = ftp(["packages", "."]);
  fs.writeFileSync(path.join(outDir, "Packages"), packages);
  execFileSync("gzip", ["-kf", "Packages"], { cwd: outDir });
  fs.writeFileSync(path.join(outDir, "Release"), ftp(["release", "."]));
  const key = process.env.WEFT_APT_GPG_KEY;
  if (key) {
    execFileSync("gpg", ["--batch", "--yes", "--default-key", key, "--clearsign", "-o", "InRelease", "Release"], { cwd: outDir });
    execFileSync("gpg", ["--batch", "--yes", "--default-key", key, "-abs", "-o", "Release.gpg", "Release"], { cwd: outDir });
  } else console.warn("WEFT_APT_GPG_KEY isn't set: the repo is unsigned, so apt will refuse it without [trusted=yes].");
  console.log(`Wrote an apt repo with ${debs.length} package(s) in ${outDir}`);
}

function main() {
  const [command, a, b, c] = process.argv.slice(2);
  if (command === "cask" && a) return writeCask(a, b, c || "dist");
  if (command === "apt" && a) return writeApt(a, b || "dist/apt");
  console.error("usage: node scripts/release-channels.mjs cask <version> [dmg] [outDir] | apt <debDir> [outDir]");
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main();
