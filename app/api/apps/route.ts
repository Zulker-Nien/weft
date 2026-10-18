import { dropAppShare } from "@/lib/app-share";
import { fail, guard } from "@/lib/guard";
import { listApps, removeApp, saveApp, updateApp } from "@/lib/mini-app-store";

// The apps sidebar's mini apps (lib/mini-app-store.ts): pages from the browser pane saved as apps.

type Body = { id?: unknown; url?: unknown; name?: unknown; to?: unknown };

export function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  return Response.json({ apps: listApps() });
}

// { url, name? }: saves the page as an app (or renames the app it already is).
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Body;
    return Response.json({ app: saveApp(body.url, body.name) });
  } catch (err) {
    return fail(err);
  }
}

// { id, name?, to? }: renames it, or moves it to place `to`.
export async function PATCH(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Body;
    return Response.json({ app: updateApp(body.id, { name: body.name, to: body.to }) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Body;
    const app = listApps().find((a) => a.id === body.id);
    removeApp(body.id);
    // Its share link goes with it; the app is gone either way.
    await dropAppShare(app).catch(() => {});
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
