import { fail, guard } from "@/lib/guard";
import { createTag, deleteTag, listTags, updateTag } from "@/lib/tag-store";

// The tag catalog (lib/tag-store.ts), like a repo's GitHub labels. A tag is named in the body, not the
// path, since a name can hold spaces and slashes.

type Body = { name?: unknown; color?: unknown; description?: unknown; rename?: unknown };

export function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  return Response.json({ tags: listTags() });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Body;
    return Response.json({ tag: createTag(body.name, body.color, body.description) });
  } catch (err) {
    return fail(err);
  }
}

// { name, rename?, color?, description? }: rename gives it a new name on every card.
export async function PATCH(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Body;
    return Response.json({ tag: updateTag(body.name, { name: body.rename, color: body.color, description: body.description }) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Body;
    deleteTag(body.name);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
