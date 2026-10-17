import fs from "node:fs";
import { Readable } from "node:stream";
import { attachmentFile, mimeFor } from "@/lib/attachments";
import { fail, guard } from "@/lib/guard";

// Attachments are shown in the board, never run: a pasted SVG or HTML file gets no scripts.
const HEADERS = {
  "content-security-policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
  "x-content-type-options": "nosniff",
  "cache-control": "private, max-age=31536000, immutable",
  "accept-ranges": "bytes",
};

function stream(file: string, start?: number, end?: number) {
  return Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
}

// Serves a saved attachment. Video players seek with Range requests, so those get partial responses.
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  const { name } = await params;
  try {
    const file = attachmentFile(name);
    if (!file) return Response.json({ error: "No such attachment." }, { status: 404 });

    const size = fs.statSync(file).size;
    const type = mimeFor(name);
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
    if (range && (range[1] || range[2])) {
      // "bytes=-500" is the last 500 bytes.
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { ...HEADERS, "content-range": `bytes */${size}` } });
      }
      return new Response(stream(file, start, end), {
        status: 206,
        headers: {
          ...HEADERS,
          "content-type": type,
          "content-length": String(end - start + 1),
          "content-range": `bytes ${start}-${end}/${size}`,
        },
      });
    }
    return new Response(stream(file), { headers: { ...HEADERS, "content-type": type, "content-length": String(size) } });
  } catch (err) {
    return fail(err);
  }
}
