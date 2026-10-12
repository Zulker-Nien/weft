import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assetName, changelogSection, feedFor } from "./release-feed.mjs";

const CHANGELOG = `# Changelog

## [Unreleased]

## [0.4.0] - 2026-10-20

### Added
- Auto-updates.

## [0.3.0] - 2026-10-11

### Fixed
- Things.

[Unreleased]: https://github.com/aimhuge/weft/compare/v0.4.0...HEAD
`;

describe("changelogSection", () => {
  it("returns one version's body, without its heading", () => {
    expect(changelogSection(CHANGELOG, "0.4.0")).toBe("### Added\n- Auto-updates.");
  });

  it("stops at the link references after the last version", () => {
    expect(changelogSection(CHANGELOG, "0.3.0")).toBe("### Fixed\n- Things.");
  });

  it("reads to the end when nothing follows", () => {
    expect(changelogSection("## [1.0.0]\n- last", "1.0.0")).toBe("- last");
  });

  it("is null for a version that isn't there", () => {
    expect(changelogSection(CHANGELOG, "9.9.9")).toBeNull();
  });

  it("finds the real 0.3.0 section in CHANGELOG.md", () => {
    const text = fs.readFileSync(path.join(__dirname, "..", "CHANGELOG.md"), "utf8");
    expect(changelogSection(text, "0.3.0")).toContain("### Added");
  });
});

describe("feedFor", () => {
  it("writes Squirrel's static JSON feed plus the release page and dmg", () => {
    const feed = feedFor("0.4.0", "notes", new Date("2026-10-20T00:00:00Z"));
    expect(feed).toEqual({
      currentRelease: "0.4.0",
      releases: [
        {
          version: "0.4.0",
          updateTo: {
            version: "0.4.0",
            name: "Weft 0.4.0",
            pub_date: "2026-10-20T00:00:00.000Z",
            notes: "notes",
            url: "https://github.com/aimhuge/weft/releases/download/v0.4.0/Weft-0.4.0-arm64.zip",
          },
        },
      ],
      page: "https://github.com/aimhuge/weft/releases/tag/v0.4.0",
      download: "https://github.com/aimhuge/weft/releases/download/v0.4.0/Weft-0.4.0-arm64.dmg",
    });
  });

  it("names assets the way package.json's artifactName does", () => {
    expect(assetName("1.2.3", "zip")).toBe("Weft-1.2.3-arm64.zip");
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as { build: { mac: { artifactName: string } } };
    expect(pkg.build.mac.artifactName).toBe("Weft-${version}-${arch}.${ext}");
  });
});
