// lib/codex-input.ts: what a Codex turn is handed. codexInput reads every branch of an SDK user
// message's content (string, text parts, base64 images, and every way a part can fail to be one
// of those); writeImages runs against a real temp dir so the bytes on disk are the real decoded
// base64.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterAll, describe, expect, it } from "vitest";
import { codexInput, writeImages } from "./codex-input";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-codex-input-test-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }), 30_000);

// codexInput only reads `type` and `message.content`; the cast keeps each fixture to exactly the
// two fields under test instead of a full SDKMessage per shape.
const user = (content: unknown) => ({ type: "user", message: { content } }) as unknown as SDKMessage;
const other = (type: string) => ({ type, message: { content: "ignored" } }) as unknown as SDKMessage;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

describe("codexInput", () => {
  it("returns nothing for a message that isn't a user message", () => {
    expect(codexInput(other("assistant"))).toEqual({ text: "", images: [] });
    expect(codexInput(other("system"))).toEqual({ text: "", images: [] });
    expect(codexInput(other("result"))).toEqual({ text: "", images: [] });
  });

  it("passes string content straight through as the text", () => {
    expect(codexInput(user("hello there"))).toEqual({ text: "hello there", images: [] });
    expect(codexInput(user(""))).toEqual({ text: "", images: [] });
  });

  it("returns nothing for content that is neither a string nor an array", () => {
    expect(codexInput(user(undefined))).toEqual({ text: "", images: [] });
    expect(codexInput(user(null))).toEqual({ text: "", images: [] });
    expect(codexInput(user(42))).toEqual({ text: "", images: [] });
    expect(codexInput(user({ text: "nope" }))).toEqual({ text: "", images: [] });
  });

  it("joins the array's text parts with newlines and collects base64 images", () => {
    const message = user([
      { type: "text", text: "first" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: b64("png-bytes") } },
      { type: "text", text: "second" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64("jpeg-bytes") } },
    ]);
    expect(codexInput(message)).toEqual({
      text: "first\nsecond",
      images: [
        { mediaType: "image/png", data: b64("png-bytes") },
        { mediaType: "image/jpeg", data: b64("jpeg-bytes") },
      ],
    });
  });

  it("returns empty strings and lists for an empty content array", () => {
    expect(codexInput(user([]))).toEqual({ text: "", images: [] });
  });

  it("keeps a single text part as the whole text", () => {
    expect(codexInput(user([{ type: "text", text: "only" }]))).toEqual({ text: "only", images: [] });
  });

  it("skips a text part whose text isn't a string, and an empty one", () => {
    expect(codexInput(user([{ type: "text", text: "" }, { type: "text", text: "kept" }]))).toEqual({
      text: "kept",
      images: [],
    });
    expect(codexInput(user([{ type: "text" }, { type: "text", text: 7 }, { type: "text", text: "kept" }]))).toEqual({
      text: "kept",
      images: [],
    });
  });

  it("skips parts with no source at all", () => {
    expect(codexInput(user([{ type: "text", text: "hi" }, { type: "tool_result", content: "x" }]))).toEqual({
      text: "hi",
      images: [],
    });
  });

  it("skips an image whose source is missing or isn't an object", () => {
    expect(codexInput(user([{ type: "image" }, { type: "image", source: null }, { type: "image", source: "raw" }]))).toEqual({
      text: "",
      images: [],
    });
  });

  it("skips a source that isn't base64, or is missing a field or has a non-string one", () => {
    expect(codexInput(user([{ type: "image", source: { type: "url", url: "https://example.com/a.png" } }]))).toEqual({
      text: "",
      images: [],
    });
    // type: "base64" but no media_type.
    expect(codexInput(user([{ type: "image", source: { type: "base64", data: b64("x") } }]))).toEqual({ text: "", images: [] });
    // media_type present but not a string.
    expect(codexInput(user([{ type: "image", source: { type: "base64", media_type: 5, data: b64("x") } }]))).toEqual({
      text: "",
      images: [],
    });
    // no data at all.
    expect(codexInput(user([{ type: "image", source: { type: "base64", media_type: "image/png" } }]))).toEqual({
      text: "",
      images: [],
    });
    // data present but not a string.
    expect(codexInput(user([{ type: "image", source: { type: "base64", media_type: "image/png", data: 1 } }]))).toEqual({
      text: "",
      images: [],
    });
  });

  it("accepts an unknown media type as an image; writeImages is what names its extension", () => {
    expect(codexInput(user([{ type: "image", source: { type: "base64", media_type: "image/avif", data: b64("x") } }]))).toEqual({
      text: "",
      images: [{ mediaType: "image/avif", data: b64("x") }],
    });
  });

  it("keeps the images in the order the parts arrived", () => {
    const message = user([
      { type: "image", source: { type: "base64", media_type: "image/gif", data: b64("gif") } },
      { type: "image", source: { type: "base64", media_type: "image/png", data: b64("png") } },
      { type: "image", source: { type: "base64", media_type: "image/gif", data: b64("gif2") } },
    ]);
    expect(codexInput(message).images.map((i) => i.data)).toEqual([b64("gif"), b64("png"), b64("gif2")]);
  });
});

describe("writeImages", () => {
  it("returns no directory and no paths for an empty list", () => {
    expect(writeImages([])).toEqual({ directory: undefined, paths: [] });
  });

  it("writes each image into a fresh temp dir, named image-<n>.<ext> by media type", () => {
    const images = [
      { mediaType: "image/png", data: b64("png-bytes") },
      { mediaType: "image/jpeg", data: b64("jpeg-bytes") },
      { mediaType: "image/webp", data: b64("webp-bytes") },
      { mediaType: "image/gif", data: b64("gif-bytes") },
    ];
    const { directory, paths } = writeImages(images);
    expect(directory).toMatch(new RegExp(`^${escapeRe(os.tmpdir())}[/\\\\]weft-codex-`));
    expect(paths).toEqual([
      path.join(directory!, "image-0.png"),
      path.join(directory!, "image-1.jpg"),
      path.join(directory!, "image-2.webp"),
      path.join(directory!, "image-3.gif"),
    ]);
    // The bytes on disk are the real decoded base64, each in its own file.
    expect(fs.readFileSync(paths[0]!, "utf8")).toBe("png-bytes");
    expect(fs.readFileSync(paths[1]!, "utf8")).toBe("jpeg-bytes");
    expect(fs.readFileSync(paths[2]!, "utf8")).toBe("webp-bytes");
    expect(fs.readFileSync(paths[3]!, "utf8")).toBe("gif-bytes");
  });

  it("falls back to a .png extension for a media type it has no mapping for", () => {
    const { directory, paths } = writeImages([
      { mediaType: "image/avif", data: b64("avif-bytes") },
      { mediaType: "", data: b64("no-media-type") },
    ]);
    expect(paths).toEqual([path.join(directory!, "image-0.png"), path.join(directory!, "image-1.png")]);
    expect(fs.readFileSync(paths[0]!, "utf8")).toBe("avif-bytes");
    expect(fs.readFileSync(paths[1]!, "utf8")).toBe("no-media-type");
  });

  it("numbers images from zero within one call", () => {
    const { paths } = writeImages([
      { mediaType: "image/png", data: b64("a") },
      { mediaType: "image/png", data: b64("b") },
    ]);
    expect(paths.map((p) => path.basename(p))).toEqual(["image-0.png", "image-1.png"]);
  });

  it("gives each call its own directory so two turns' images never mix", () => {
    const first = writeImages([{ mediaType: "image/png", data: b64("first") }]);
    const second = writeImages([{ mediaType: "image/png", data: b64("second") }]);
    expect(first.directory).not.toBe(second.directory);
    // Both calls name their one file image-0.png; only the directory differs.
    expect(path.basename(first.paths[0]!)).toBe(path.basename(second.paths[0]!));
    expect(fs.readFileSync(first.paths[0]!, "utf8")).toBe("first");
    expect(fs.readFileSync(second.paths[0]!, "utf8")).toBe("second");
  });

  it("writes each file readable only by its owner (mode 0600)", () => {
    const { paths } = writeImages([{ mediaType: "image/png", data: b64("private") }]);
    expect(fs.statSync(paths[0]!).mode & 0o777).toBe(0o600);
  });

  it("writes an empty file for an image with no data", () => {
    const { paths } = writeImages([{ mediaType: "image/png", data: "" }]);
    expect(fs.readFileSync(paths[0]!, "utf8")).toBe("");
  });
});

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}