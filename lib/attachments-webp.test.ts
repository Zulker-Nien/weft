import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// WebP conversion with the real sharp (lib/attachments.ts). sips (the image shrinker) is mocked: execFile records the call, execFileSync writes whatever
// preview the test sets up. ATTACHMENTS_DIR is read at import, so each test re-imports.
const sips = vi.hoisted(() => ({ preview: null as Buffer | null }));
vi.mock("node:child_process", async () => {
  const { writeFileSync } = await import("node:fs");
  return {
    execFile: vi.fn(),
    execFileSync: vi.fn((_bin: string, args: string[]) => {
      if (sips.preview) writeFileSync(args[args.length - 1]!, sips.preview);
      else throw new Error("sips failed");
    }),
  };
});

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
const BIG = 3_800_000; // just over the 3.7 MB image limit

let dir: string;
let child: typeof import("node:child_process");

async function load() {
  vi.resetModules();
  child = await import("node:child_process");
  return import("./attachments");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-attach-"));
  process.env.WEFT_DATA = dir;
  sips.preview = null;
  vi.clearAllMocks();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("WebP for saved images", () => {
  const untilFile = async (file: string) => {
    for (let i = 0; i < 100 && !fs.existsSync(file); i++) await new Promise((r) => setTimeout(r, 20));
  };

  it("saveAttachmentData converts a PNG in the background, then returns the WebP for the same bytes", async () => {
    const { saveAttachmentData } = await load();
    const first = saveAttachmentData(PNG, "screenshot", "image/png");
    expect(first.name).toMatch(/^screenshot-[0-9a-f]{12}\.png$/);
    const webp = first.path.replace(/\.png$/, ".webp");
    await untilFile(webp);
    const again = saveAttachmentData(PNG, "screenshot", "image/png");
    expect(again).toMatchObject({ name: path.basename(webp), kind: "image", url: `/api/attachments/${path.basename(webp)}` });
    expect(fs.readFileSync(again.path).subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(fs.existsSync(first.path)).toBe(true); // threads may still point at it
  });

  it("leaves bytes sharp can't read as they are, with no WebP or temp file", async () => {
    const { saveAttachmentData, ATTACHMENTS_DIR } = await load();
    const saved = saveAttachmentData(JPEG, "pane.jpg", "image/jpeg");
    await new Promise((r) => setTimeout(r, 200));
    expect(fs.readdirSync(ATTACHMENTS_DIR)).toEqual([saved.name]);
  });

  it("saveImageData returns the WebP right away and keeps no original", async () => {
    const { saveImageData, ATTACHMENTS_DIR } = await load();
    const saved = await saveImageData(PNG, "pane.jpg", "image/jpeg");
    expect(saved.name).toMatch(/^pane-[0-9a-f]{12}\.webp$/);
    expect(fs.readdirSync(ATTACHMENTS_DIR)).toEqual([saved.name]);
    expect((await saveImageData(PNG, "pane.jpg", "image/jpeg")).path).toBe(saved.path);
  });

  it("saveImageData converts from an original saveAttachmentData kept, and keeps it", async () => {
    const { saveAttachmentData, saveImageData } = await load();
    const kept = saveAttachmentData(PNG, "shot.png");
    const saved = await saveImageData(PNG, "shot.png");
    expect(saved.name).toMatch(/\.webp$/);
    expect(fs.existsSync(kept.path)).toBe(true);
  });

  it("leaves a WebP that came in named .png alone", async () => {
    const { saveImageData } = await load();
    const sharp = (await import("sharp")).default;
    const webp = await sharp(PNG).webp().toBuffer();
    const saved = await saveImageData(webp, "mislabelled.png");
    expect(saved.name).toMatch(/\.png$/);
  });

  it("saveImageData starts a preview for a WebP still over the image limit", async () => {
    const { saveImageData } = await load();
    const stat = fs.statSync;
    vi.spyOn(fs, "statSync").mockImplementation((p: fs.PathLike) => {
      const st = stat(p);
      if (String(p).endsWith(".webp")) Object.defineProperty(st, "size", { value: BIG });
      return st;
    });
    await saveImageData(PNG, "huge.png");
    expect(child.execFile).toHaveBeenCalledTimes(1);
  });

  it("saveImageData saves non-rasters and unreadable images as they are", async () => {
    const { saveImageData } = await load();
    expect((await saveImageData(WEBP, "a.webp")).name).toMatch(/\.webp$/);
    expect((await saveImageData(Buffer.from("<svg/>"), "a.svg")).name).toMatch(/\.svg$/);
    const broken = await saveImageData(JPEG, "b.jpg");
    expect(broken.name).toMatch(/^b-[0-9a-f]{12}\.jpg$/);
    expect(fs.readFileSync(broken.path)).toEqual(JPEG);
  });
});

