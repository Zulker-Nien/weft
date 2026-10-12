import { connection } from "next/server";
import { resolveFolder } from "@/lib/folders";
import { asText } from "@/lib/format";
import { disableIssueSync, enableIssueSync, issueSyncFolders, issueSyncStatus, syncIssues } from "@/lib/github-issues";
import { fail, guard } from "@/lib/guard";

// GitHub issues as Backlog cards (lib/github-issues.ts). GET lists the folders that sync and how their
// last sync went; POST { folder } syncs it now and keeps it syncing; DELETE { folder } stops that.

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json({ folders: issueSyncFolders(), status: issueSyncStatus() });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const folder = resolveFolder(body.folder);
    // Synced first, so a folder with no GitHub remote isn't left polling.
    const counts = await syncIssues(folder);
    enableIssueSync(folder);
    return Response.json({ folder, ...counts });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const folder = asText(body.folder).trim();
    if (!folder) throw new Error("Which folder should stop syncing its issues?");
    disableIssueSync(folder);
    return Response.json({ folders: issueSyncFolders() });
  } catch (err) {
    return fail(err);
  }
}
