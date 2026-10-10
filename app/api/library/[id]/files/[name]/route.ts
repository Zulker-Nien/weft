import fs from "node:fs";
import path from "node:path";
import { mimeFor } from "@/lib/attachments";
import { guard } from "@/lib/guard";
import { getItem, itemDir, PAGE_HEADERS } from "@/lib/library";

const MORE_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".json": "application/json",
};

// The images and files a saved page points at (copied beside it when it was starred).
export async function GET(req: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  const { id, name } = await params;
  const item = getItem(id);
  // Only a plain file name: no folders, no way out of the item's files/.
  if (!item || name !== path.basename(name) || name.startsWith(".")) return new Response("Not found", { status: 404 });
  const file = path.join(itemDir(item), "files", name);
  if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
  const type = MORE_TYPES[path.extname(name).toLowerCase()] ?? mimeFor(name);
  return new Response(fs.readFileSync(file), { headers: { ...PAGE_HEADERS, "content-type": type, "cache-control": "private, max-age=3600" } });
}
