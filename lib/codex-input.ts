import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type CodexPrompt = { text: string; images: { mediaType: string; data: string }[] };
type CodexContentPart = Exclude<Extract<SDKMessage, { type: "user" }>["message"]["content"], string>[number];

function textFromPart(part: CodexContentPart) {
  return "text" in part && typeof part.text === "string" ? part.text : undefined;
}

function imageFromPart(part: CodexContentPart): CodexPrompt["images"][number] | undefined {
  if (!("source" in part)) return undefined;
  const source = part.source;
  if (!source || typeof source !== "object") return undefined;
  if (
    "type" in source && source.type === "base64" &&
    "media_type" in source && typeof source.media_type === "string" &&
    "data" in source && typeof source.data === "string"
  ) return { mediaType: source.media_type, data: source.data };
  return undefined;
}

export function codexInput(message: SDKMessage): CodexPrompt {
  if (message.type !== "user") return { text: "", images: [] };
  const content = message.message.content;
  if (typeof content === "string") return { text: content, images: [] };
  if (!Array.isArray(content)) return { text: "", images: [] };
  const texts: string[] = [];
  const images: CodexPrompt["images"] = [];
  for (const part of content) {
    const text = textFromPart(part);
    if (text) texts.push(text);
    const image = imageFromPart(part);
    if (image) images.push(image);
  }
  return { text: texts.join("\n"), images };
}

export function writeImages(images: CodexPrompt["images"]) {
  if (!images.length) return { directory: undefined, paths: [] as string[] };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "weft-codex-"));
  const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  const paths = images.map((image, index) => {
    const extension = extensions[image.mediaType] ?? "png";
    const file = path.join(directory, `image-${index}.${extension}`);
    fs.writeFileSync(file, Buffer.from(image.data, "base64"), { mode: 0o600 });
    return file;
  });
  return { directory, paths };
}

export const CODEX_INPUT_CODE = [codexInput, writeImages, textFromPart, imageFromPart];
