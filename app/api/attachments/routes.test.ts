import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Both attachment routes run against real files in a temp WEFT_DATA; only sips is never
// reached (nothing here is a big image).
const WRITE = { host: "localhost", "x-weft-token": "1" };
const URL_BASE = "http://localhost/api/attachments";

let dir: string;
let upload: typeof import("./route");
let serve: typeof import("./[name]/route");

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-attach-route-"));
  process.env.WEFT_DATA = dir;
  upload = await import("./route");
  serve = await import("./[name]/route");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  upload.POST(new Request(URL_BASE, { method: "POST", body, headers: { ...WRITE, ...headers } }));

const get = (name: string, headers: Record<string, string> = {}) =>
  serve.GET(new Request(`${URL_BASE}/${name}`, { headers: { host: "localhost", ...headers } }), {
    params: Promise.resolve({ name }),
  });

/** The attachment the upload route replies with. */
const attachment = async (res: Response) => (await res.json()) as { name: string; url: string; path: string };

describe("POST /api/attachments", () => {
  it("saves the body under the x-filename name and returns the attachment", async () => {
    const res = await post("hello world", { "x-filename": encodeURIComponent("My Notes.txt"), "content-type": "text/plain" });
    expect(res.status).toBe(200);
    const saved = await attachment(res);
    expect(saved).toMatchObject({ kind: "file", bytes: 11 });
    expect(saved.name).toMatch(/^my-notes-[0-9a-f]{8}\.txt$/);
    expect(saved.url).toBe(`/api/attachments/${saved.name}`);
    expect(fs.readFileSync(saved.path, "utf8")).toBe("hello world");
  });

  it("names a file without x-filename 'pasted', with the extension from its type", async () => {
    const saved = await attachment(await post("x", { "content-type": "image/png" }));
    expect(saved.name).toMatch(/^pasted-[0-9a-f]{8}\.png$/);
  });

  it("saves as .bin when there's neither a name nor a content type", async () => {
    // A Blob body with no type sends no content-type at all.
    const saved = await attachment(await post(new Blob(["x"])));
    expect(saved.name).toMatch(/^pasted-[0-9a-f]{8}\.bin$/);
  });

  it("refuses a request without the write header", async () => {
    const res = await upload.POST(new Request(URL_BASE, { method: "POST", body: "x", headers: { host: "localhost" } }));
    expect(res.status).toBe(403);
  });

  it("is a 400 with no body, an empty body, or a malformed name", async () => {
    const none = await post(null);
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: "No file was sent." });

    const empty = await post("", { "x-filename": "a.txt" });
    expect(await empty.json()).toEqual({ error: "That file is empty." });

    const bad = await post("x", { "x-filename": "%E0%A4%A" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/URI/);
  });
});

describe("GET /api/attachments/[name]", () => {
  let name: string;
  beforeAll(async () => {
    name = (await attachment(await post("0123456789", { "x-filename": "digits.txt" }))).name;
  });

  it("serves the whole file with locked-down headers", async () => {
    const res = await get(name);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("0123456789");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("refuses a foreign host", async () => {
    expect((await get(name, { host: "evil.com" })).status).toBe(403);
  });

  it("is a 404 for an unknown or unsafe name", async () => {
    const missing = await get("nope-1.png");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "No such attachment." });
    expect((await get("../board.json")).status).toBe(404);
  });

  it.each([
    ["bytes=2-5", "2345", "bytes 2-5/10"],
    ["bytes=7-", "789", "bytes 7-9/10"],
    ["bytes=-3", "789", "bytes 7-9/10"],
    ["bytes=-50", "0123456789", "bytes 0-9/10"],
    ["bytes=8-100", "89", "bytes 8-9/10"],
  ])("answers Range %s with a 206 partial response", async (range, text, contentRange) => {
    const res = await get(name, { range });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe(text);
    expect(res.headers.get("content-range")).toBe(contentRange);
    expect(res.headers.get("content-length")).toBe(String(text.length));
  });

  it.each(["bytes=10-", "bytes=5-2"])("answers an unsatisfiable Range %s with a 416", async (range) => {
    const res = await get(name, { range });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */10");
  });

  it.each(["bytes=-", "items=1-2", "bytes=1-2,4-5"])("serves the whole file for a Range it ignores: %s", async (range) => {
    const res = await get(name, { range });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("0123456789");
  });
});
