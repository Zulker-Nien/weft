import { paneUrl } from "@/lib/browser-tools";
import { asText } from "@/lib/format";
import { fail, guard } from "@/lib/guard";
import { complete } from "@/lib/haiku";
import { listLibrary, starCard } from "@/lib/library";
import { getCard } from "@/lib/store";
import { LIBRARY_KINDS, type LibraryKind, type LibraryScope } from "@/lib/types";

// The library rail's items: yours and one project's (?folder=), or every project's (?all=1).
export function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  return Response.json({ items: listLibrary({ folder: params.get("folder"), all: params.get("all") === "1" }) });
}

// Stars a card: files it in the library as a recipe, a to-do or a note.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { cardId?: unknown; kind?: LibraryKind; scope?: LibraryScope };
    const card = getCard(asText(body.cardId));
    if (!card || card.role === "copilot") return fail("No such card.", 404);
    const kind = LIBRARY_KINDS.find((k) => k.id === body.kind)?.id ?? "note";
    const scope: LibraryScope = body.scope === "mine" ? "mine" : "project";
    const item = await starCard(card, kind, scope, { paneUrl, complete });
    return Response.json({ item });
  } catch (err) {
    return fail(err);
  }
}
