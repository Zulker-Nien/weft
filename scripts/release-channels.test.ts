import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { caskFor, sha256 } from "./release-channels.mjs";

describe("release-channels", () => {
  it("writes a cask for the version, its dmg and its sha", () => {
    const cask = caskFor("1.2.3", "abc123");
    expect(cask).toContain('version "1.2.3"');
    expect(cask).toContain('sha256 "abc123"');
    expect(cask).toContain("releases/download/v#{version}/Weft-#{version}-arm64.dmg");
    expect(cask).toContain('app "Weft.app"');
  });

  it("hashes a file with sha256", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "weft-ch-")), "a.txt");
    fs.writeFileSync(file, "hello");
    expect(sha256(file)).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});
