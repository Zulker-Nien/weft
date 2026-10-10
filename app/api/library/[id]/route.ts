import { fail, guard } from "@/lib/guard";
import { removeItem, updateItem, type LibraryPatch } from "@/lib/library";
import { LIBRARY_KINDS } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

// Renames, refiles (kind, mine or project) or saves a to-do's ticks.
export async function PATCH(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const patch: LibraryPatch = {};
    if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 120);
    if (LIBRARY_KINDS.some((k) => k.id === body.kind)) patch.kind = body.kind as LibraryPatch["kind"];
    if (body.scope === "mine" || body.scope === "project") patch.scope = body.scope;
    if (Array.isArray(body.ticked)) patch.ticked = body.ticked.filter((n): n is number => typeof n === "number");
    return Response.json({ item: updateItem(id, patch) });
  } catch (err) {
    return fail(err);
  }
}

// Takes it out of the library and unstars its card.
export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    removeItem(id);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
