import { connection } from "next/server";
import { resolveFolder } from "@/lib/folders";
import { fail, guard } from "@/lib/guard";
import { setSyncFolder, syncFolders } from "@/lib/settings";
import { cloudSyncStatus, queueFolder, syncNow } from "@/lib/cloud-sync";

// The Settings → Sync page (lib/use-cloud-sync.ts, components/SyncSettings.tsx). GET returns which folders
// have sync turned on and how the last flush went; POST turns a folder on or off (and queues its cards when
// on) or asks for a flush right now ({ sync: true }).

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json({ folders: syncFolders(), status: cloudSyncStatus() });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (body.sync === true) {
      syncNow();
      return Response.json({ status: cloudSyncStatus() });
    }
    const folder = resolveFolder(body.folder);
    const on = body.on !== false;
    setSyncFolder(folder, on);
    // Turning a folder on also flushes its existing cards and items.
    if (on) queueFolder(folder);
    return Response.json({ folder, on, folders: syncFolders(), status: cloudSyncStatus() });
  } catch (err) {
    return fail(err);
  }
}
