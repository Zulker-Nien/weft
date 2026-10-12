import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TARGETS, patchNext, patchSource } from "./patch-next-hmr.mjs";

const STRICT_LINE =
  "if (parsedData.hmrVersion !== undefined && parsedData.hmrVersion !== String(clientHmrVersion)) {";

describe("patchSource", () => {
  it("reloads only a page whose version is newer than the server's", () => {
    const { status, source } = patchSource(`a\n${STRICT_LINE}\nb`);
    expect(status).toBe("patched");
    expect(source).toContain("Number(parsedData.hmrVersion) > clientHmrVersion");
    expect(source).not.toContain("!== String(clientHmrVersion)");
  });

  it("leaves a patched file alone", () => {
    const once = patchSource(STRICT_LINE).source;
    expect(patchSource(once)).toEqual({ status: "already", source: once });
  });

  it("reports a Next whose check changed", () => {
    expect(patchSource("nothing here").status).toBe("missing");
  });
});

describe("patchNext", () => {
  it("patches both the CommonJS and ESM copies and skips files that aren't there", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "patch-next-"));
    const cjs = path.join(root, TARGETS[0] ?? "");
    fs.mkdirSync(path.dirname(cjs), { recursive: true });
    fs.writeFileSync(cjs, STRICT_LINE);
    expect(patchNext(root).map((r) => r.status)).toEqual(["patched", "missing"]);
    expect(patchNext(root).map((r) => r.status)).toEqual(["already", "missing"]);
  });

  it("finds the check in the installed Next", () => {
    const root = path.resolve(__dirname, "..");
    for (const rel of TARGETS) expect(patchSource(fs.readFileSync(path.join(root, rel), "utf8")).status).not.toBe("missing");
  });
});
