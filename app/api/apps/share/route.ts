import { connection } from "next/server";
import { AppShareError, getAppShare, setAppShare } from "@/lib/app-share";
import type { AppShareUpdate } from "@/lib/app-share-types";
import { fail, guard } from "@/lib/guard";

// A mini app's Share dialog (components/ShareAppDialog.tsx): GET ?id= the app's share state, PUT { id, mode, password? }.
// Why an app can't be shared (signed out, no workspace, a page only this Mac reaches) is a state, not an error;
// errors are a missing app, a refused mode or password, and Supabase failing.

function failed(err: unknown) {
  return fail(err, err instanceof AppShareError ? err.status : 500);
}

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("Send ?id=.");
  try {
    return Response.json(await getAppShare(id));
  } catch (err) {
    return failed(err);
  }
}

export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as (Partial<AppShareUpdate> & { id?: unknown }) | null;
  if (!body || typeof body !== "object" || typeof body.id !== "string") return fail("Send { id, mode, password? }.");
  try {
    return Response.json(await setAppShare(body.id, { mode: body.mode as AppShareUpdate["mode"], password: body.password }));
  } catch (err) {
    return failed(err);
  }
}
