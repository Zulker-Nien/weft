import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveAttachmentData } from "./attachments";
import { clip } from "./format";
import { MEDIA_REF, attachmentName, mediaKind, mediaMarkdown } from "./media";

// Images that reach a thread some other way than being pasted into a message: a screenshot a tool
// returned, an image pasted into a Claude Code session that Weft picked up, or a file the agent shows
// with ![...](path). Each is copied into the attachments folder, so the board serves one folder only.

interface Block {
  type?: string;
  text?: string;
  // The API's image block, and the MCP one tools return.
  source?: { type?: string; media_type?: string; data?: string };
  data?: string;
  mimeType?: string;
}

// Bigger files than this aren't copied; the ref is left as it is.
const MAX_COPY_BYTES = 200 * 1024 ** 2;

const g = globalThis as unknown as { __threadboardCopied?: Map<string, string> };
// Files already copied, by "path|size|mtime", so a transcript read doesn't hash them again.
const copied = (g.__threadboardCopied ??= new Map<string, string>());

// Saves an image block's bytes and returns the attachment, or undefined if it isn't one.
function saveImageBlock(block: Block, name: string) {
  const data = block.source?.type === "base64" ? block.source.data : block.data;
  const type = block.source?.media_type ?? block.mimeType ?? "";
  if (block.type !== "image" || !data || !type.startsWith("image/")) return undefined;
  try {
    return saveAttachmentData(Buffer.from(data, "base64"), name, type);
  } catch (err) {
    console.error("Couldn't save an image from the thread:", err);
    return undefined;
  }
}

// A tool result's text, and the URLs of any images in it (a screenshot, say).
export function toolResult(content: unknown): { result: string; images?: string[] } {
  if (typeof content === "string") return { result: clip(content, 4000) };
  if (!Array.isArray(content)) return { result: "" };
  const texts: string[] = [];
  const images: string[] = [];
  for (const block of content as Block[]) {
    if (block?.type === "text") texts.push(block.text ?? "");
    else if (block?.type === "image") {
      const saved = saveImageBlock(block, "screenshot");
      if (saved) images.push(saved.url);
      else texts.push("[image]");
    } else texts.push(`[${block?.type}]`);
  }
  return { result: clip(texts.join("\n"), 4000), images: images.length ? images : undefined };
}

// Markdown refs for the images pasted into a Claude Code message, to add to its text.
export function pastedImages(blocks: Block[]): string[] {
  return blocks.flatMap((block) => {
    const saved = saveImageBlock(block, "pasted-image");
    return saved ? [mediaMarkdown(saved.name, saved.path)] : [];
  });
}

function resolvePath(src: string, cwd: string) {
  if (src.startsWith("file://")) src = decodeURIComponent(src.slice(7));
  if (src.startsWith("~/")) return path.join(os.homedir(), src.slice(2));
  return path.resolve(cwd, src);
}

// The attachment path for a local image, video, or sound, copying it in the first time.
function adopt(src: string, cwd: string) {
  const file = resolvePath(src, cwd);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_COPY_BYTES) return undefined;
    const key = `${file}|${stat.size}|${stat.mtimeMs}`;
    let saved = copied.get(key);
    if (!saved) {
      saved = saveAttachmentData(fs.readFileSync(file), path.basename(file)).path;
      copied.set(key, saved);
    }
    return saved;
  } catch {
    return undefined;
  }
}

// The agent's text, with each ![...](local image, video, or sound) pointing at a copy in the attachments
// folder so the board can show it. Web URLs, attachments, and missing files are left alone.
export function adoptLocalMedia(text: string, cwd: string) {
  if (!text.includes("![")) return text;
  return text.replace(MEDIA_REF, (ref, alt: string, bracketed?: string, bare?: string) => {
    const src = bracketed ?? bare ?? "";
    if (/^https?:\/\//.test(src) || attachmentName(src) || mediaKind(src) === "file") return ref;
    const saved = adopt(src, cwd);
    return saved ? mediaMarkdown(alt, saved) : ref;
  });
}
