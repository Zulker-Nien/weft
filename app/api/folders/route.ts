import fs from "node:fs";
import path from "node:path";
import { fail, elevated } from "@/lib/guard";
import { allowFolder, unallowFolder } from "@/lib/settings";

// "Always allow" on a folder-guard prompt (lib/folder-guard.ts): every card may use that folder outside its project from now on.
export async function POST(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    const { folder } = (await req.json()) as { folder?: unknown };
    if (typeof folder !== "string" || !path.isAbsolute(folder)) throw new Error("folder must be an absolute path.");
    if (!fs.statSync(folder).isDirectory()) throw new Error("That isn't a folder.");
    allowFolder(folder);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err, 400);
  }
}

// Takes a folder back out of that list, from Settings → General's trusted-folders row. It doesn't check the
// folder still exists: a folder that's gone can't be left in the list taking up space, and the revoke is the
// point. Absent is fine too, so the button can be pressed twice.
export async function DELETE(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    const { folder } = (await req.json()) as { folder?: unknown };
    if (typeof folder !== "string" || !folder) throw new Error("folder must be a path.");
    unallowFolder(folder);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err, 400);
  }
}
