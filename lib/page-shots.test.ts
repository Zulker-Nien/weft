import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  paneUrl: vi.fn<(key: string) => Promise<string | undefined>>(),
  paneThumb: vi.fn<(key: string) => Promise<Buffer | undefined>>(),
}));

let dataDir: string;
let s: typeof import("./page-shots");
let capture: Buffer;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-shots-"));
  vi.resetModules();
  vi.doMock("./browser-tools", () => ({ paneUrl: h.paneUrl, paneThumb: h.paneThumb }));
  vi.doMock("./store", () => ({ DATA_DIR: dataDir }));
  s = await import("./page-shots");
  // A pane capture the size electron/browser-pane.cjs sends: 480 px wide, noisy enough to compress like a page.
  const noise = Buffer.from(Array.from({ length: 480 * 640 * 3 }, (_, i) => (i * 37) % 251));
  capture = await sharp(noise, { raw: { width: 480, height: 640, channels: 3 } }).jpeg({ quality: 78 }).toBuffer();
});

afterAll(() => {
  for (const m of ["./browser-tools", "./store"]) vi.doUnmock(m);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  fs.rmSync(path.join(dataDir, "shots"), { recursive: true, force: true });
});

const URL_A = "file:///tmp/show/plan.html";
const LOCAL = "http://localhost:3000/";
const name = (url: string) => s.shotName(url).split(".")[0]!;

describe("page shots", () => {
  it("shrinks a capture to a small WebP of the page's top", async () => {
    const small = (await s.shrink(capture))!;
    const meta = await sharp(small).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", s.SHOT.width, s.SHOT.height]);
    expect(small.length).toBeLessThan(capture.length / 4);
    await expect(s.shrink(Buffer.from("not an image"))).resolves.toBeUndefined();
  });

  it("keeps the newest picture of each page per card, and lists them with their time", async () => {
    await s.saveShot("c1", URL_A, capture, 1);
    await s.saveShot("c1", URL_A, capture, 2);
    await s.saveShot("c1", LOCAL, capture, 3);
    expect(s.listShots("c1")).toEqual({
      [URL_A]: `/api/cards/c1/shots?img=${name(URL_A)}&v=2`,
      [LOCAL]: `/api/cards/c1/shots?img=${name(LOCAL)}&v=3`,
    });
    expect((await sharp(s.readShot("c1", name(URL_A))).metadata()).format).toBe("webp");
    expect(s.listShots("c2")).toEqual({});
  });

  it("lists no picture for an entry from an older format", async () => {
    await s.saveShot("c1", URL_A, capture, 1);
    const index = path.join(dataDir, "shots", "c1", "index.json");
    fs.writeFileSync(index, JSON.stringify({ ...JSON.parse(fs.readFileSync(index, "utf8")), [LOCAL]: { file: "0123456789abcdef.jpg", at: 2 } }));
    expect(Object.keys(s.listShots("c1"))).toEqual([URL_A]);
  });

  it("saves nothing for a capture that won't decode", async () => {
    await expect(s.saveShot("c1", URL_A, Buffer.from("jpg"))).resolves.toBe(false);
    expect(s.listShots("c1")).toEqual({});
  });

  it("reads only its own picture names", async () => {
    await s.saveShot("c1", URL_A, capture);
    expect(s.readShot("c1", "../index")).toBeUndefined();
    expect(s.readShot("c1", "0123456789abcdef")).toBeUndefined();
  });

  it("keeps a card id that isn't a plain name inside the shots folder", async () => {
    await s.saveShot("../evil", URL_A, capture);
    expect(fs.existsSync(path.join(dataDir, "shots", "___evil", "index.json"))).toBe(true);
    expect(s.listShots("../evil")[URL_A]).toContain("/api/cards/..%2Fevil/shots?img=");
  });

  describe("captureShot", () => {
    it("captures the page while the pane still shows it", async () => {
      h.paneUrl.mockResolvedValue(URL_A);
      h.paneThumb.mockResolvedValue(capture);
      await expect(s.captureShot("c1", URL_A, 100)).resolves.toBe(true);
      expect(s.readShot("c1", name(URL_A))).toBeDefined();
    });

    it("skips a page captured moments ago, one the pane moved on from, and an empty capture", async () => {
      await s.saveShot("c1", URL_A, capture, 100);
      await expect(s.captureShot("c1", URL_A, 100 + s.FRESH_MS - 1)).resolves.toBe(false);
      expect(h.paneUrl).not.toHaveBeenCalled();
      h.paneUrl.mockResolvedValueOnce("http://elsewhere/");
      await expect(s.captureShot("c1", URL_A, 100 + s.FRESH_MS)).resolves.toBe(false);
      h.paneUrl.mockResolvedValueOnce(URL_A);
      h.paneThumb.mockResolvedValueOnce(undefined);
      await expect(s.captureShot("c1", URL_A, 100 + s.FRESH_MS)).resolves.toBe(false);
      expect(s.listShots("c1")[URL_A]).toContain("&v=100");
    });
  });
});
