import { addVercelHook, hookedTeams, removeVercelHook } from "@/lib/vercel-hooks";
import { resolveFolder } from "@/lib/folders";
import { fail, guard } from "@/lib/guard";

// Live pull from Vercel (lib/vercel-hooks.ts): GET says which teams have a pull webhook on your Weft account, POST
// { folder } puts one on its project's team (and pulls once now), DELETE { folder } takes it off.

async function folderOf(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  if (typeof body.folder !== "string") throw new Error("Provide a folder.");
  return resolveFolder(body.folder);
}

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  try {
    return Response.json(await hookedTeams());
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json(await addVercelHook(await folderOf(req)));
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    await removeVercelHook(await folderOf(req));
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
