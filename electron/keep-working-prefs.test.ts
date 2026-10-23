import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import prefsModule from "./keep-working-prefs.cjs";

const { DEFAULT_PREFS, cleanPrefs, readPrefs, writePrefs } = prefsModule;

describe("keep-working prefs", () => {
  it("keeps only known keys with allowed values", () => {
    expect(cleanPrefs({ auto: true, minBattery: 20, onlineOnly: false, extra: 1 })).toEqual({ auto: true, minBattery: 20, onlineOnly: false });
    expect(cleanPrefs({ auto: "yes", minBattery: 7, onlineOnly: 1 })).toEqual({});
    expect(cleanPrefs(null)).toEqual({});
  });

  it("reads defaults when the file is missing or broken, and round-trips a write", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kwp-"));
    const file = path.join(dir, "sub", "keep-working.json");
    expect(readPrefs(file)).toEqual(DEFAULT_PREFS);
    writePrefs(file, { ...DEFAULT_PREFS, minBattery: 30 });
    expect(readPrefs(file)).toEqual({ ...DEFAULT_PREFS, minBattery: 30 });
    fs.writeFileSync(file, "{nope");
    expect(readPrefs(file)).toEqual(DEFAULT_PREFS);
  });
});
