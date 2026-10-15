import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { loadTranscript } from "@/lib/import";
import { getCard, getThread } from "@/lib/store";
import { pageThread, trimToolResult } from "@/lib/thread-page";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const { id } = await params;
  const card = getCard(id);
  if (!card) return fail("No such card.", 404);
  try {
    await loadTranscript(card);
  } catch (err) {
    console.error("Couldn't read the session transcript:", err);
  }
  // ?before=<n>&limit=<n> pages the thread, newest first (lib/thread-page.ts). With no params the
  // whole thread is returned, so older clients keep working.
  const url = new URL(req.url);
  const before = parseIntParam(url.searchParams.get("before"));
  const limit = parseIntParam(url.searchParams.get("limit"));
  const items = getThread(id);
  const paged = before !== undefined || limit !== undefined;
  const page = paged ? pageThread(items, { before, limit }) : { items, start: 0, total: items.length };
  // Tool results longer than the inline cap are left out of items and fetched on demand; do this
  // before the page slice so total still reflects the un-trimmed thread.
  const trimmed = page.items.map(trimToolResult);
  return Response.json({ items: trimmed, start: page.start, total: page.total });
}

function parseIntParam(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.floor(n);
}
