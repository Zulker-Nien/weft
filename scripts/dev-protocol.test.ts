import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { protectedFolder, launcherScript, warnIfProtected } = require("./dev-protocol.cjs") as {
  protectedFolder: (root: string, home?: string) => string | null;
  launcherScript: (root: string) => string;
  warnIfProtected: (root: string, log: (message: string) => void) => boolean;
};

const home = os.homedir();

describe("protectedFolder", () => {
  it("names the macOS-guarded folder a checkout sits in", () => {
    expect(protectedFolder(path.join(home, "Desktop", "Projects", "weft"))).toBe("Desktop");
    expect(protectedFolder(path.join(home, "Documents", "weft"))).toBe("Documents");
    expect(protectedFolder(path.join(home, "Downloads"))).toBe("Downloads");
  });

  it("leaves other folders alone, including lookalike names", () => {
    expect(protectedFolder(path.join(home, "dev", "weft"))).toBeNull();
    expect(protectedFolder(path.join(home, "Desktop-old", "weft"))).toBeNull();
    expect(protectedFolder("/Users/someone-else/Desktop/weft", "/Users/me")).toBeNull();
  });
});

describe("launcherScript", () => {
  it("reads package.json before starting Electron and explains a refusal", () => {
    const script = launcherScript("/Users/a/Desktop/weft");
    expect(script).toContain('PROJECT="/Users/a/Desktop/weft"');
    expect(script.indexOf('head -c1 "$PROJECT/package.json"')).toBeLessThan(script.indexOf("exec "));
    expect(script).toContain("Weft can't open its folder");
    expect(script).toContain("Privacy & Security → Files and Folders");
  });
});

describe("warnIfProtected", () => {
  it("warns only for a guarded checkout", () => {
    const log = vi.fn();
    expect(warnIfProtected(path.join(home, "Desktop", "weft"), log)).toBe(true);
    expect(log.mock.calls[0]?.[0]).toContain("~/Desktop");
    expect(warnIfProtected(path.join(home, "dev", "weft"), log)).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
