import fs from "node:fs";
import path from "node:path";
import { fail, guard } from "@/lib/guard";
import { allowFolder } from "@/lib/settings";

// "Always allow" on a folder-guard prompt (lib/folder-guard.ts): every card may use that folder outside its project from now on.
export async function POST(req: Request) {
  const denied = guard(req);
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
