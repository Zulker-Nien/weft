// The rules electron/app-data.cjs adds on top of app-data.test.ts: which folder a page may sit in, and that a read
// needs only its own vault names (a blank GA4 key mustn't stop the Supabase reads).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appFolderFromUrl, manifestHash, type Manifest } from "./app-data.cjs";
import { upstreamMessage } from "./app-data-reads.cjs";
import { SAMPLE_MANIFEST, frameEvent, makeApp, makeAppData, makeDataDir, makeVault, type FetchLike } from "./app-data-test-helpers";

const WITH_GA4: Manifest = {
  ...SAMPLE_MANIFEST,
  reads: { ...SAMPLE_MANIFEST.reads, pageviews: { ga4: { metrics: [{ name: "screenPageViews" }] } } },
};

const okFetch: FetchLike = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('[{"day":"2026-10-18","signups":1}]') });

describe("which page may ask", () => {
  it("refuses a page in the apps folder itself, or nested deeper in an app", () => {
    const dataDir = makeDataDir();
    fs.writeFileSync(path.join(dataDir, "apps", "index.html"), "");
    fs.writeFileSync(path.join(dataDir, "apps", "weft-app.json"), "{}");
    expect(() => appFolderFromUrl(dataDir, `file://${dataDir}/apps/index.html`)).toThrow("its own folder");
    const nested = path.join(dataDir, "apps", "growth", "inner");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "index.html"), "");
    fs.writeFileSync(path.join(nested, "weft-app.json"), "{}");
    expect(() => appFolderFromUrl(dataDir, `file://${nested}/index.html`)).toThrow("its own folder");
  });

  it("says a page isn't Weft's when there's no apps folder yet", () => {
    const dataDir = makeDataDir();
    fs.rmSync(path.join(dataDir, "apps"), { recursive: true });
    const page = path.join(dataDir, "page.html");
    fs.writeFileSync(page, "");
    expect(() => appFolderFromUrl(dataDir, `file://${page}`)).toThrow("Open this app in Weft");
  });
});

describe("a read's own names", () => {
  it("runs a Supabase read while the GA4 names are still blank, and names what a GA4 read lacks", async () => {
    const dataDir = makeDataDir();
    const app = makeApp(dataDir, "growth", WITH_GA4);
    const vault = makeVault({ label: "aimhuge/weft", values: { SUPABASE_SECRET_KEY: "sb_secret_x" } });
    const ad = makeAppData({ dataDir, vault, fetch: okFetch });
    await ad.requestAccess(frameEvent({ url: app.url }));
    await expect(ad.read(frameEvent({ url: app.url }), "signups", null)).resolves.toEqual({ rows: [{ day: "2026-10-18", signups: 1 }] });
    await expect(ad.read(frameEvent({ url: app.url }), "pageviews", null)).rejects.toThrow(
      "GA4_PROPERTY_ID, GA4_SERVICE_ACCOUNT_JSON have no value in aimhuge/weft · production yet.",
    );
  });

  it("voids a grant when a read's definition changes, not only its name", () => {
    const changed: Manifest = { ...SAMPLE_MANIFEST, reads: { ...SAMPLE_MANIFEST.reads, overview: { supabase: "growth_everything" } } };
    expect(manifestHash(changed)).not.toBe(manifestHash(SAMPLE_MANIFEST));
  });
});

describe("upstream errors", () => {
  it("reads Supabase's, Google's and the token endpoint's messages, else the text or the fallback", () => {
    expect(upstreamMessage('{"code":"42883","message":"function x() does not exist","hint":"Check the name."}', "f")).toBe("function x() does not exist (Check the name.)");
    expect(upstreamMessage('{"error":{"code":403,"message":"User does not have sufficient permissions"}}', "f")).toBe("User does not have sufficient permissions");
    expect(upstreamMessage('{"error":"invalid_grant","error_description":"Invalid JWT signature."}', "f")).toBe("Invalid JWT signature.");
    expect(upstreamMessage("Bad gateway", "f")).toBe("Bad gateway");
    expect(upstreamMessage("", "Supabase answered 502.")).toBe("Supabase answered 502.");
  });
});
