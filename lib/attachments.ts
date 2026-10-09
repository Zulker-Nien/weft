import { execFile, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { ATTACHMENT_NAME, IMAGE_EXTENSIONS, MEDIA_REF, extensionOf, mediaKind, type MediaKind } from "./media";
import { DATA_DIR } from "./store";

export const ATTACHMENTS_DIR = path.join(DATA_DIR, "attachments");

// A pasted screen recording can be big, but not this big.
const MAX_BYTES = 2 * 1024 ** 3;
// The API takes images up to 5 MB once base64-encoded, which is about 3.75 MB of file.
const MAX_IMAGE_BYTES = 3_700_000;

type Content = SDKUserMessage["message"]["content"];
type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  json: "application/json",
};

export function mimeFor(name: string) {
  return MIME[extensionOf(name)] ?? "application/octet-stream";
}

// "Screen Shot 2026-10-09 at 10.20.png" -> "screen-shot-2026-10-09-at-10-20-<id>.png"
function fileNameFor(original: string, type: string, id: string) {
  const ext =
    extensionOf(original).replace(/[^a-z0-9]/g, "").slice(0, 8) ||
    Object.entries(MIME).find(([, mime]) => mime === type)?.[0] ||
    "bin";
  const stem = original.replace(/\.[^.]*$/, "");
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "pasted"}-${id}.${ext}`;
}

export interface SavedAttachment {
  name: string;
  path: string;
  url: string;
  kind: MediaKind;
  bytes: number;
}

// Streams an upload into the attachments folder under a fresh name.
export async function saveAttachment(
  body: ReadableStream<Uint8Array>,
  originalName: string,
  type: string,
): Promise<SavedAttachment> {
  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  const name = fileNameFor(originalName, type, randomUUID().slice(0, 8));
  const file = path.join(ATTACHMENTS_DIR, name);
  let bytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      done(bytes > MAX_BYTES ? new Error("That file is over 2 GB.") : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), limit, fs.createWriteStream(file));
  } catch (err) {
    fs.rmSync(file, { force: true });
    throw err;
  }
  if (bytes === 0) {
    fs.rmSync(file, { force: true });
    throw new Error("That file is empty.");
  }
  if (mediaKind(name) === "image" && bytes > MAX_IMAGE_BYTES) makePreview(file);
  return { name, path: file, url: `/api/attachments/${name}`, kind: mediaKind(name), bytes };
}

// Saves bytes the server already has (a screenshot in a tool result, say). The name comes from the
// content, so saving the same bytes under the same file name again returns the file already saved.
export function saveAttachmentData(data: Buffer, originalName: string, type = ""): SavedAttachment {
  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  const name = fileNameFor(originalName, type, createHash("sha1").update(data).digest("hex").slice(0, 12));
  const file = path.join(ATTACHMENTS_DIR, name);
  if (!fs.existsSync(file)) {
    // Write then rename, so a reader never sees half a file.
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, data);
    fs.renameSync(temp, file);
    if (mediaKind(name) === "image" && data.length > MAX_IMAGE_BYTES) makePreview(file);
  }
  return { name, path: file, url: `/api/attachments/${name}`, kind: mediaKind(name), bytes: data.length };
}

// The file for an attachment name, or null if there's no such attachment.
export function attachmentFile(name: string) {
  if (!ATTACHMENT_NAME.test(name)) return null;
  const file = path.join(ATTACHMENTS_DIR, name);
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

function previewPath(file: string) {
  return `${file}.preview.jpg`;
}

// A smaller JPEG of a big image, for the image block. macOS's sips does the resizing.
function makePreview(file: string) {
  execFile("/usr/bin/sips", ["-Z", "2560", "-s", "format", "jpeg", "-s", "formatOptions", "85", file, "--out", previewPath(file)], () => {});
}

function sniff(data: Buffer): ImageMediaType | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

// The bytes to send for an image, shrunk if it's over the API's limit; null if it can't be sent.
function imageData(file: string): { data: Buffer; mediaType: ImageMediaType } | null {
  try {
    let source = file;
    if (fs.statSync(file).size > MAX_IMAGE_BYTES) {
      source = previewPath(file);
      if (!fs.existsSync(source)) {
        execFileSync("/usr/bin/sips", ["-Z", "2560", "-s", "format", "jpeg", "-s", "formatOptions", "85", file, "--out", source], {
          stdio: "ignore",
          timeout: 20_000,
        });
      }
      if (fs.statSync(source).size > MAX_IMAGE_BYTES) return null;
    }
    const data = fs.readFileSync(source);
    const mediaType = sniff(data);
    return mediaType ? { data, mediaType } : null;
  } catch {
    return null;
  }
}

// A message's content for the CLI. Each image pasted into the text is also sent as an image block
// right where it sits, so the agent sees it in place; the path stays in the text so it can use the
// file too. Videos and other files go as paths only. Text without images goes as plain text.
export function messageContent(text: string): Content {
  const blocks: Exclude<Content, string> = [];
  let last = 0;
  for (const match of text.matchAll(MEDIA_REF)) {
    const file = path.resolve(match[2] ?? match[3]);
    if (path.dirname(file) !== ATTACHMENTS_DIR || !IMAGE_EXTENSIONS.has(extensionOf(file))) continue;
    const image = imageData(file);
    if (!image) continue;
    const end = match.index + match[0].length;
    blocks.push({ type: "text", text: text.slice(last, end) });
    blocks.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data.toString("base64") } });
    last = end;
  }
  if (!blocks.length) return text;
  const rest = text.slice(last);
  if (rest.trim()) blocks.push({ type: "text", text: rest });
  return blocks;
}
