import { connection } from "next/server";
import { recordClick } from "@/lib/copilot-sources";
import { boardContext, boardSuggestions } from "@/lib/copilot-suggest";
import { fail, guard } from "@/lib/guard";
import { listCards } from "@/lib/store";

// The copilot's chips made from the board (lib/copilot-suggest.ts): GET them (?context=1: what Haiku reads for them, to
// check a source), POST the one you clicked so later chips lean toward what you use.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    if (new URL(req.url).searchParams.get("context") === "1") return new Response(await boardContext(listCards()), { headers: { "content-type": "text/plain; charset=utf-8" } });
    return Response.json(await boardSuggestions(listCards()));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  const denied = guard(req, { write: true });
  if (denied) return denied;
  try {
    const { text } = (await req.json().catch(() => ({}))) as { text?: unknown };
    if (typeof text !== "string" || !text.trim()) return Response.json({ error: "text is required" }, { status: 400 });
    recordClick(text.trim().slice(0, 200));
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
