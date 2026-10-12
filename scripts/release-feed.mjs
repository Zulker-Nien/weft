// Writes a release's update.json, the feed electron/updater.cjs reads from the latest GitHub release, and
// its notes (that version's CHANGELOG.md section), for .github/workflows/release.yml:
//   node scripts/release-feed.mjs <version> [outDir]      (default outDir: dist)
// The feed is Squirrel.Mac's static JSON format; `page` and `download` are extras Squirrel ignores, for
// the unsigned fallback that sends you to the release page.
import fs from "node:fs";
import path from "node:path";

const REPO = "https://github.com/aimhuge/weft";

export const assetName = (version, ext, arch = "arm64") => `Weft-${version}-${arch}.${ext}`;

// The body of `## [version]` in a Keep a Changelog file, without its heading; null when it's missing.
export function changelogSection(text, version) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## ") || /^\[[^\]]+\]: /.test(line));
  return rest.slice(0, end < 0 ? undefined : end).join("\n").trim();
}

export function feedFor(version, notes, date = new Date()) {
  const base = `${REPO}/releases/download/v${version}`;
  return {
    currentRelease: version,
    releases: [
      {
        version,
        updateTo: { version, name: `Weft ${version}`, pub_date: date.toISOString(), notes, url: `${base}/${assetName(version, "zip")}` },
      },
    ],
    page: `${REPO}/releases/tag/v${version}`,
    download: `${base}/${assetName(version, "dmg")}`,
  };
}

function main() {
  const [version, outDir = "dist"] = process.argv.slice(2);
  if (!version) {
    console.error("usage: node scripts/release-feed.mjs <version> [outDir]");
    process.exit(1);
  }
  const root = path.resolve(import.meta.dirname, "..");
  const notes = changelogSection(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), version);
  if (notes == null) {
    console.error(`release-feed: CHANGELOG.md has no "## [${version}]" section. Add one before tagging.`);
    process.exit(1);
  }
  const out = path.resolve(root, outDir);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "update.json"), `${JSON.stringify(feedFor(version, notes), null, 2)}\n`);
  fs.writeFileSync(path.join(out, "release-notes.md"), `${notes}\n`);
  console.log(`Wrote ${path.relative(root, out)}/update.json and release-notes.md for ${version}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main();
