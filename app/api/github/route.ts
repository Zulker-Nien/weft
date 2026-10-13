import { connection } from "next/server";
import { githubStatus } from "@/lib/github-status";
import { fail, guard } from "@/lib/guard";

// The GitHub drawer's status (lib/github-status.ts): GET ?folder=…&folder=… is who gh is signed in as, and each
// folder's repo and issue sync. Turning sync on and off is /api/github/issues.

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const folders = new URL(req.url).searchParams.getAll("folder").filter(Boolean);
    return Response.json(await githubStatus(folders));
  } catch (err) {
    return fail(err);
  }
}
