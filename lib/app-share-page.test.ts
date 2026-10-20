// lib/app-share.ts's appPage, the URL → { blob | site | none } mapper (lib/app-share-types.ts holds the
// url builder). Pure function: takes a `home` argument, so each test runs against its own scratch dir
// instead of the real home.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appPage } from "./app-share";

describe("appPage", () => {
  const withTmpHome = (fn: (home: string) => void) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-app-share-unit-"));
    try { fn(home); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  };

  it("maps a file:// page inside home to a blob with its hash kept", () => {
    withTmpHome((home) => {
      const file = path.join(home, "page.html");
      fs.writeFileSync(file, "<h1>hi</h1>");
      expect(appPage(`file://${file}#step-2`, home)).toEqual({ kind: "blob", local: file, hash: "#step-2" });
      expect(appPage(`file://${file}`, home)).toEqual({ kind: "blob", local: file, hash: "" });
    });
  });

  it("refuses a file:// page outside home or one that is gone", () => {
    withTmpHome((home) => {
      const outside = path.join(os.tmpdir(), "page.html");
      fs.writeFileSync(outside, "x");
      expect(appPage(`file://${outside}#hash`, home)).toEqual({ kind: "none", reason: "This app's file is gone, outside your home folder, or one Weft never uploads (a secret, the vault)." });
      fs.rmSync(outside);
      expect(appPage(`file://${path.join(home, "gone.html")}#hash`, home).kind).toBe("none");
    });
  });

  it("refuses localhost, .local, and LAN hosts", () => {
    for (const url of [
      "http://localhost:3000", "http://my-app.localhost:5173", "http://printer.local",
      "http://127.0.0.1:8080", "http://0.0.0.0", "http://[::1]",
      "http://10.0.0.5", "http://192.168.1.1", "http://172.16.0.1",
    ]) expect(appPage(url).kind).toBe("none");
  });

  // The same hosts over https: a weft.zip frame can't reach a page only this Mac or this network
  // can show, regardless of scheme. The reason the user sees names the host, so the message still
  // says why it can't be shared.
  it("refuses https on localhost, .local, and LAN hosts too", () => {
    for (const url of [
      "https://localhost:3000", "https://my-app.localhost:5173", "https://printer.local",
      "https://127.0.0.1:8080", "https://[::1]",
      "https://10.0.0.5", "https://192.168.1.1", "https://172.16.0.1",
    ]) expect(appPage(url).kind).toBe("none");
  });

  // Link-local ranges (169.254/16 IPv4, fe80::/10 IPv6) sit on this Mac's own network only and
  // are unreachable from the weft.zip server, so they get the same refusal as 192.168.x.x.
  it("refuses link-local ranges over https with a network message", () => {
    const result = appPage("https://169.254.169.254/latest/meta-data");
    expect(result.kind).toBe("none");
    if (result.kind === "none") expect(result.reason).toMatch(/your network/);
  });

  it("passes https sites through unchanged", () => {
    expect(appPage("https://example.com/x?y=1#z")).toEqual({ kind: "site", url: "https://example.com/x?y=1#z" });
  });

  it("refuses http (non-local) and any non-URL string", () => {
    expect(appPage("http://example.com")).toMatchObject({ kind: "none" });
    expect(appPage("not a url")).toMatchObject({ kind: "none" });
  });
});