import { addHook, removeHook } from "@/lib/github-hooks";
import { resolveFolder } from "@/lib/folders";
import { fail, guard } from "@/lib/guard";

// Instant issue sync (lib/github-hooks.ts): POST { folder } puts a webhook on its repo that Weft's Supabase relays
// back here; DELETE { folder } takes it off. The 5-minute poll (/api/github/issues) runs either way.

async function folderOf(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  return resolveFolder(body.folder);
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json(await addHook(await folderOf(req)));
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    await removeHook(await folderOf(req));
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
