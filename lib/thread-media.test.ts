import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real files throughout: THREADBOARD_DATA and HOME point at a fresh temp dir and the module is
// re-imported, with its "already copied" cache (kept on globalThis) cleared.
const PNG64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG = Buffer.from(PNG64, "base64");
const g = globalThis as unknown as { __threadboardCopied?: unknown };

let dir: string;
let attachments: string;
const realHome = process.env.HOME;

async function load() {
  vi.resetModules();
  delete g.__threadboardCopied;
  return import("./thread-media");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-media-"));
  process.env.THREADBOARD_DATA = path.join(dir, "data");
  attachments = path.join(dir, "data", "attachments");
});
afterEach(() => {
  process.env.HOME = realHome;
  vi.restoreAllMocks();
  delete g.__threadboardCopied;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("liveToolResult", () => {
  it("is toolResult, sync, when there are no images", async () => {
    const { liveToolResult } = await load();
    expect(liveToolResult([{ type: "text", text: "hi" }])).toEqual({ result: "hi" });
    expect(liveToolResult("ok")).toEqual({ result: "ok" });
  });

  it("returns a Promise when any image block is present, so handleToolResults can wait for the WebP", async () => {
    const { liveToolResult } = await load();
    const textOnly = liveToolResult([{ type: "text", text: "no shot" }]);
    const withShot = liveToolResult([{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG64 } }]);
    expect(textOnly).not.toBeInstanceOf(Promise);
    expect(withShot).toBeInstanceOf(Promise);
    // Resolving the promise returns a ToolResult, never the data URL.
    const out = await withShot;
    expect(out.images).toHaveLength(1);
    expect(out.images![0]).toMatch(/^\/api\/attachments\/screenshot-[0-9a-f]{12}\.webp$/);
  });

  it("saves a screenshot as WebP before answering, and keeps no PNG", async () => {
    const { liveToolResult } = await load();
    const out = await liveToolResult([
      { type: "text", text: "shot" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG64 } },
      { type: "image", data: "", mimeType: "image/png" },
    ]);
    expect(out.result).toBe("shot\n[image]");
    expect(out.images).toEqual([expect.stringMatching(/^\/api\/attachments\/screenshot-[0-9a-f]{12}\.webp$/)]);
    expect(fs.readdirSync(attachments).filter((f) => f.endsWith(".png"))).toEqual([]);
  });

  it("falls back to saving the bytes as they are when the WebP save throws", async () => {
    const { liveToolResult } = await load();
    const attachmentsModule = await import("./attachments");
    vi.spyOn(attachmentsModule, "saveImageData").mockRejectedValue(new Error("disk full"));
    const out = await liveToolResult([{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG64 } }]);
    expect(out.images).toEqual([expect.stringMatching(/\.png$/)]);
  });
});

describe("toolResult", () => {
  it("clips a string result to 4000 characters", async () => {
    const { toolResult } = await load();
    expect(toolResult("ok")).toEqual({ result: "ok" });
    const long = toolResult("x".repeat(5000)).result;
    expect(long).toHaveLength(4000);
    expect(long.endsWith("…")).toBe(true);
  });

  it("is empty for anything that isn't a string or a list of blocks", async () => {
    const { toolResult } = await load();
    expect(toolResult(undefined)).toEqual({ result: "" });
    expect(toolResult({ type: "text", text: "x" })).toEqual({ result: "" });
  });

  it("joins text blocks and names other blocks by type", async () => {
    const { toolResult } = await load();
    expect(toolResult([{ type: "text", text: "a" }, { type: "text" }, { type: "resource" }, null])).toEqual({
      result: "a\n\n[resource]\n[undefined]",
      images: undefined,
    });
  });

  it("saves API and MCP image blocks as attachments and returns their URLs", async () => {
    const { toolResult } = await load();
    const out = toolResult([
      { type: "text", text: "shot:" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG64 } },
      { type: "image", data: PNG64, mimeType: "image/png" },
    ]);
    expect(out.result).toBe("shot:");
    // Same bytes, same name: both blocks land on one file.
    expect(out.images).toHaveLength(2);
    expect(out.images![0]).toMatch(/^\/api\/attachments\/screenshot-[0-9a-f]{12}\.png$/);
    expect(out.images![1]).toBe(out.images![0]);
    expect(fs.readFileSync(path.join(attachments, out.images![0]!.split("/").pop()!))).toEqual(PNG);
  });

  it("writes [image] for an image block it can't save", async () => {
    const { toolResult } = await load();
    const out = toolResult([
      { type: "image", source: { type: "url", media_type: "image/png", data: PNG64 } },
      { type: "image", data: PNG64, mimeType: "application/pdf" },
      { type: "image", source: { type: "base64", data: PNG64 } },
    ]);
    expect(out).toEqual({ result: "[image]\n[image]\n[image]", images: undefined });
    expect(fs.existsSync(attachments)).toBe(false);
  });

  it("logs and writes [image] when saving fails", async () => {
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    fs.writeFileSync(attachments, "a file where the folder should be");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { toolResult } = await load();
    expect(toolResult([{ type: "image", data: PNG64, mimeType: "image/png" }]).result).toBe("[image]");
    expect(error).toHaveBeenCalledWith("Couldn't save an image from the thread:", expect.any(Error));
  });
});

describe("pastedImages", () => {
  it("returns a Markdown ref for each image block, skipping the rest", async () => {
    const { pastedImages } = await load();
    const refs = pastedImages([
      { type: "text", text: "hi" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG64 } },
    ]);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatch(new RegExp(`^!\\[pasted-image-[0-9a-f]{12}\\.png\\]\\(${attachments}/pasted-image-[0-9a-f]{12}\\.png\\)$`));
  });
});

describe("adoptLocalMedia", () => {
  function file(rel: string, data: Buffer | string = PNG) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data);
    return full;
  }
  const savedName = (text: string) => /\(<?([^)>]+)>?\)/.exec(text)![1]!;

  it("returns text without image syntax untouched", async () => {
    const { adoptLocalMedia } = await load();
    expect(adoptLocalMedia("no refs [here](/a.png)", dir)).toBe("no refs [here](/a.png)");
  });

  it("copies a local image into attachments and points the ref at the copy", async () => {
    file("project/shot.png");
    const { adoptLocalMedia } = await load();
    const out = adoptLocalMedia("see ![Shot](shot.png) ok", path.join(dir, "project"));
    expect(out).toMatch(new RegExp(`^see !\\[Shot\\]\\(${attachments}/shot-[0-9a-f]{12}\\.png\\) ok$`));
    expect(fs.readFileSync(savedName(out))).toEqual(PNG);
  });

  it("reads absolute, file:// (percent-encoded) and ~/ paths, and audio and video", async () => {
    const abs = file("a/clip.mp4", "video");
    file("my files/song.mp3", "audio");
    file("home/pic.gif", "gif");
    process.env.HOME = path.join(dir, "home");
    const { adoptLocalMedia } = await load();
    const out = adoptLocalMedia(
      `![v](${abs}) ![s](file://${encodeURI(path.join(dir, "my files/song.mp3"))}) ![p](~/pic.gif)`,
      "/",
    );
    const refs = out.split(" ");
    expect(refs[0]).toMatch(/^!\[v\]\(.*\/attachments\/clip-[0-9a-f]{12}\.mp4\)$/);
    expect(refs[1]).toMatch(/^!\[s\]\(.*\/attachments\/song-[0-9a-f]{12}\.mp3\)$/);
    expect(refs[2]).toMatch(/^!\[p\]\(.*\/attachments\/pic-[0-9a-f]{12}\.gif\)$/);
  });

  it("leaves web URLs, attachments, non-media files, missing files and folders alone", async () => {
    file("notes.txt", "text");
    fs.mkdirSync(path.join(dir, "folder.png"));
    const { adoptLocalMedia } = await load();
    const text = [
      "![w](https://x.com/a.png)",
      "![a](/h/.weft/attachments/shot-1a2b.png)",
      "![t](notes.txt)",
      "![m](missing.png)",
      "![f](folder.png)",
    ].join(" ");
    expect(adoptLocalMedia(text, dir)).toBe(text);
    expect(fs.existsSync(attachments)).toBe(false);
  });

  it("leaves a file over 200 MB alone", async () => {
    file("huge.mov", "small really");
    const stat = fs.statSync;
    vi.spyOn(fs, "statSync").mockImplementation(((p: fs.PathLike) =>
      String(p).endsWith("huge.mov") ? { isFile: () => true, size: 201 * 1024 ** 2, mtimeMs: 1 } : stat(p)) as typeof fs.statSync);
    const { adoptLocalMedia } = await load();
    expect(adoptLocalMedia("![h](huge.mov)", dir)).toBe("![h](huge.mov)");
  });

  it("copies an unchanged file only once", async () => {
    file("shot.png");
    const read = vi.spyOn(fs, "readFileSync");
    const { adoptLocalMedia } = await load();
    const first = adoptLocalMedia("![a](shot.png)", dir);
    expect(adoptLocalMedia("![b](shot.png)", dir)).toBe(first.replace("![a]", "![b]"));
    expect(read.mock.calls.filter(([p]) => String(p).endsWith("shot.png"))).toHaveLength(1);
  });

  it("keeps a bracketed path with spaces in one piece", async () => {
    file("dir with space/shot.png");
    const { adoptLocalMedia } = await load();
    const out = adoptLocalMedia(`![s](<${path.join(dir, "dir with space/shot.png")}>)`, "/");
    expect(out).toMatch(/^!\[s\]\(.*\/attachments\/shot-[0-9a-f]{12}\.png\)$/);
  });
});
