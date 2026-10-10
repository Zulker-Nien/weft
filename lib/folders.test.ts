import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveFolder } from "./folders";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-folders-")));
fs.mkdirSync(path.join(os.homedir(), "app"), { recursive: true });
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("resolveFolder", () => {
  it("returns an absolute folder as is, trimmed", () => {
    expect(resolveFolder(`  ${tmp}  `)).toBe(tmp);
  });

  it("expands ~ and ~/ to the home folder", () => {
    expect(resolveFolder("~")).toBe(os.homedir());
    expect(resolveFolder("~/app")).toBe(path.join(os.homedir(), "app"));
  });

  it("leaves a ~ that isn't a whole first segment alone", () => {
    expect(() => resolveFolder("~app")).toThrow(`${path.resolve("~app")} isn't a folder.`);
  });

  it("treats empty, null and undefined as the home folder", () => {
    expect(resolveFolder("")).toBe(os.homedir());
    expect(resolveFolder(null)).toBe(os.homedir());
    expect(resolveFolder(undefined)).toBe(os.homedir());
  });

  it("resolves a relative path against the working directory", () => {
    expect(resolveFolder("lib")).toBe(path.resolve("lib"));
  });

  it("throws for a missing path or a file", () => {
    const file = path.join(tmp, "file.txt");
    fs.writeFileSync(file, "x");
    expect(() => resolveFolder(path.join(tmp, "nope"))).toThrow(`${path.join(tmp, "nope")} isn't a folder.`);
    expect(() => resolveFolder(file)).toThrow(`${file} isn't a folder.`);
  });
});
