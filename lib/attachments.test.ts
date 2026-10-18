import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// sips (the image shrinker) is mocked: execFile records the call, execFileSync writes whatever
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
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00", "latin1");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
const BIG = 3_800_000; // just over the 3.7 MB image limit

let dir: string;
let child: typeof import("node:child_process");

async function load() {
  vi.resetModules();
  child = await import("node:child_process");
  return import("./attachments");
}

const body = (...chunks: (string | Uint8Array)[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
      c.close();
    },
  });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-attach-"));
  process.env.WEFT_DATA = dir;
  sips.preview = null;
  vi.clearAllMocks();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("mimeFor", () => {
  it("knows images, video, audio and text, case-insensitively", async () => {
    const { mimeFor } = await load();
    expect(mimeFor("a.PNG")).toBe("image/png");
    expect(mimeFor("a.jpg")).toBe("image/jpeg");
    expect(mimeFor("a.mov")).toBe("video/quicktime");
    expect(mimeFor("a.opus")).toBe("audio/ogg");
    expect(mimeFor("a.md")).toBe("text/plain; charset=utf-8");
  });

  it("falls back to octet-stream", async () => {
    const { mimeFor } = await load();
    expect(mimeFor("a.exe")).toBe("application/octet-stream");
    expect(mimeFor("noext")).toBe("application/octet-stream");
  });
});

describe("saveAttachment", () => {
  it("streams the body to a slugged, unique name in the attachments folder", async () => {
    const { saveAttachment, ATTACHMENTS_DIR } = await load();
    const saved = await saveAttachment(body("hel", "lo"), "Screen Shot 2026-10-09 at 10.20.txt", "text/plain");
    expect(saved.name).toMatch(/^screen-shot-2026-10-09-at-10-20-[0-9a-f]{8}\.txt$/);
    expect(saved.path).toBe(path.join(ATTACHMENTS_DIR, saved.name));
    expect(saved.url).toBe(`/api/attachments/${saved.name}`);
    expect(saved).toMatchObject({ kind: "file", bytes: 5 });
    expect(fs.readFileSync(saved.path, "utf8")).toBe("hello");
    expect(ATTACHMENTS_DIR).toBe(path.join(dir, "attachments"));
  });

  it("takes the extension from the content type when the name has none", async () => {
    const { saveAttachment, mimeFor } = await load();
    const saved = await saveAttachment(body(PNG), "clipboard", "image/png");
    expect(saved.name).toMatch(/^clipboard-[0-9a-f]{8}\.webp$/);
    expect(saved.kind).toBe("image");
    expect(mimeFor(saved.name)).toBe("image/webp");
    expect(fs.readFileSync(saved.path).subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("uses .bin for an unknown type and 'pasted' for a name with no letters", async () => {
    const { saveAttachment } = await load();
    const saved = await saveAttachment(body("x"), "!!!", "application/x-weird");
    expect(saved.name).toMatch(/^pasted-[0-9a-f]{8}\.bin$/);
  });

  it("keeps the slug to 40 characters and strips odd characters from the extension", async () => {
    const { saveAttachment } = await load();
    const saved = await saveAttachment(body("x"), `${"a".repeat(60)}.t_x-t`, "");
    expect(saved.name).toMatch(new RegExp(`^${"a".repeat(40)}-[0-9a-f]{8}\\.txt$`));
  });

  it("refuses an empty file and leaves nothing behind", async () => {
    const { saveAttachment, ATTACHMENTS_DIR } = await load();
    await expect(saveAttachment(body(), "empty.txt", "")).rejects.toThrow("That file is empty.");
    expect(fs.readdirSync(ATTACHMENTS_DIR)).toEqual([]);
  });

  it("removes the partial file when the upload fails", async () => {
    const { saveAttachment, ATTACHMENTS_DIR } = await load();
    const broken = new ReadableStream<Uint8Array>({
      pull(c) {
        c.error(new Error("connection reset"));
      },
    });
    await expect(saveAttachment(broken, "a.txt", "")).rejects.toThrow("connection reset");
    expect(fs.readdirSync(ATTACHMENTS_DIR)).toEqual([]);
  });

  it("starts a preview for an image over the API limit, not for a small one", async () => {
    const { saveAttachment } = await load();
    await saveAttachment(body(PNG), "small.png", "image/png");
    expect(child.execFile).not.toHaveBeenCalled();
    const saved = await saveAttachment(body(new Uint8Array(BIG)), "big.png", "image/png");
    expect(child.execFile).toHaveBeenCalledWith(
      "/usr/bin/sips",
      ["-Z", "2560", "-s", "format", "jpeg", "-s", "formatOptions", "85", saved.path, "--out", `${saved.path}.preview.jpg`],
      expect.any(Function),
    );
    // The callback ignores sips's result.
    const done = vi.mocked(child.execFile).mock.calls[0]![2] as unknown as () => void;
    expect(() => done()).not.toThrow();
  });

  it("doesn't preview a big file that isn't an image", async () => {
    const { saveAttachment } = await load();
    await saveAttachment(body(new Uint8Array(BIG)), "big.mov", "video/quicktime");
    expect(child.execFile).not.toHaveBeenCalled();
  });
});

describe("saveAttachmentData", () => {
  it("names the file by its content, so the same bytes save once", async () => {
    const { saveAttachmentData } = await load();
    const first = saveAttachmentData(PNG, "Screenshot.png");
    expect(first.name).toMatch(/^screenshot-[0-9a-f]{12}\.png$/);
    expect(first).toMatchObject({ kind: "image", bytes: PNG.length, url: `/api/attachments/${first.name}` });
    expect(fs.readFileSync(first.path)).toEqual(PNG);

    fs.writeFileSync(first.path, "marker");
    const again = saveAttachmentData(PNG, "Screenshot.png");
    expect(again.path).toBe(first.path);
    expect(fs.readFileSync(again.path, "utf8")).toBe("marker"); // not rewritten
    expect(saveAttachmentData(GIF, "Screenshot.png").path).not.toBe(first.path);
  });

  it("leaves no temp file behind", async () => {
    const { saveAttachmentData, ATTACHMENTS_DIR } = await load();
    const saved = saveAttachmentData(Buffer.from("{}"), "note", "application/json");
    expect(saved.name).toMatch(/^note-[0-9a-f]{12}\.json$/);
    expect(fs.readdirSync(ATTACHMENTS_DIR)).toEqual([saved.name]);
  });

  it("starts a preview only for a big new image", async () => {
    const { saveAttachmentData } = await load();
    saveAttachmentData(Buffer.alloc(BIG), "big.png");
    expect(child.execFile).toHaveBeenCalledTimes(1);
    saveAttachmentData(Buffer.alloc(BIG), "big.png"); // already saved
    saveAttachmentData(Buffer.alloc(BIG), "big.wav");
    expect(child.execFile).toHaveBeenCalledTimes(1);
  });
});

describe("attachmentFile", () => {
  it("returns the path of a saved attachment", async () => {
    const { attachmentFile, saveAttachmentData } = await load();
    const saved = saveAttachmentData(PNG, "a.png");
    expect(attachmentFile(saved.name)).toBe(saved.path);
  });

  it("is null for a bad name, a missing file, or a folder", async () => {
    const { attachmentFile, ATTACHMENTS_DIR } = await load();
    fs.mkdirSync(path.join(ATTACHMENTS_DIR, "folder.png"), { recursive: true });
    fs.writeFileSync(path.join(dir, "secret.txt"), "s");
    expect(attachmentFile("../secret.txt")).toBeNull();
    expect(attachmentFile("missing.png")).toBeNull();
    expect(attachmentFile("folder.png")).toBeNull();
  });
});

describe("messageContent", () => {
  async function withFile(name: string, data: Buffer) {
    const mod = await load();
    fs.mkdirSync(mod.ATTACHMENTS_DIR, { recursive: true });
    const file = path.join(mod.ATTACHMENTS_DIR, name);
    fs.writeFileSync(file, data);
    return { ...mod, file };
  }

  it("sends text without image refs as a plain string", async () => {
    const { messageContent } = await load();
    expect(messageContent("just words")).toBe("just words");
  });

  it("puts each attached image right after its ref, keeping the text around it", async () => {
    const { messageContent, file } = await withFile("shot-1.png", PNG);
    const content = messageContent(`look ![shot](${file}) here`);
    expect(content).toEqual([
      { type: "text", text: `look ![shot](${file})` },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG.toString("base64") } },
      { type: "text", text: " here" },
    ]);
  });

  it("drops trailing whitespace-only text and reads angle-bracketed refs", async () => {
    const { messageContent, file } = await withFile("a-1.jpg", JPEG);
    const content = messageContent(`![a](<${file}>)\n  `);
    expect(content).toHaveLength(2);
    expect(content[1]).toMatchObject({ type: "image", source: { media_type: "image/jpeg" } });
  });

  it("sniffs GIF and WebP from the bytes, not the extension", async () => {
    const mod = await withFile("g-1.png", GIF);
    fs.writeFileSync(path.join(mod.ATTACHMENTS_DIR, "w-1.png"), WEBP);
    const content = mod.messageContent(`![g](${mod.file}) ![w](${path.join(mod.ATTACHMENTS_DIR, "w-1.png")})`);
    expect(content).toMatchObject([
      { type: "text" },
      { type: "image", source: { media_type: "image/gif" } },
      { type: "text" },
      { type: "image", source: { media_type: "image/webp" } },
    ]);
  });

  it("leaves refs outside the attachments folder, non-images, missing files and unknown bytes as text", async () => {
    const mod = await withFile("v-1.mp4", Buffer.from("video"));
    fs.writeFileSync(path.join(mod.ATTACHMENTS_DIR, "fake-1.png"), "not a png");
    fs.writeFileSync(path.join(dir, "outside.png"), PNG);
    const text = [
      `![o](${path.join(dir, "outside.png")})`,
      `![v](${mod.file})`,
      `![m](${path.join(mod.ATTACHMENTS_DIR, "missing-1.png")})`,
      `![f](${path.join(mod.ATTACHMENTS_DIR, "fake-1.png")})`,
    ].join(" ");
    expect(mod.messageContent(text)).toBe(text);
  });

  it("sends an existing preview in place of a big image", async () => {
    const { messageContent, file } = await withFile("big-1.png", Buffer.alloc(BIG));
    fs.writeFileSync(`${file}.preview.jpg`, JPEG);
    const content = messageContent(`![b](${file})`);
    expect(content[1]).toMatchObject({ source: { media_type: "image/jpeg", data: JPEG.toString("base64") } });
    expect(child.execFileSync).not.toHaveBeenCalled();
  });

  it("makes the preview with sips when it's missing", async () => {
    const { messageContent, file } = await withFile("big-1.png", Buffer.alloc(BIG));
    sips.preview = JPEG;
    const content = messageContent(`![b](${file})`);
    expect(child.execFileSync).toHaveBeenCalledWith(
      "/usr/bin/sips",
      ["-Z", "2560", "-s", "format", "jpeg", "-s", "formatOptions", "85", file, "--out", `${file}.preview.jpg`],
      { stdio: "ignore", timeout: 20_000 },
    );
    expect(content[1]).toMatchObject({ source: { media_type: "image/jpeg" } });
  });

  it("sends a big image as text only when sips fails or the preview is still too big", async () => {
    const { messageContent, file } = await withFile("big-1.png", Buffer.alloc(BIG));
    const text = `![b](${file})`;
    expect(messageContent(text)).toBe(text); // sips throws
    sips.preview = Buffer.alloc(BIG);
    expect(messageContent(text)).toBe(text);
  });
});
