import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { captureShot, listShots, readShot } from "@/lib/page-shots";

// The show rail's page pictures (lib/page-shots.ts): ?img=<name> is one picture, else the page → src map.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const { id } = await params;
  const img = new URL(req.url).searchParams.get("img");
  if (img === null) return Response.json({ shots: listShots(id) });
  const webp = readShot(id, img);
  if (!webp) return fail("No such picture.", 404);
  // Each capture has its own ?v=, so a picture never changes under its url.
  return new Response(new Uint8Array(webp), { headers: { "content-type": "image/webp", "cache-control": "private, max-age=31536000, immutable" } });
}

// A page settled in the card's pane: capture it (unless it moved on, or was captured moments ago).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  const { url } = (await req.json().catch(() => ({}))) as { url?: unknown };
  if (typeof url !== "string" || !url) return fail("Which page?");
  try {
    await captureShot(id, url);
    return Response.json({ shots: listShots(id) });
  } catch (err) {
    return fail(err);
  }
}
