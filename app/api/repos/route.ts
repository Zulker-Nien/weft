import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { localRepos } from "@/lib/repos";

// Recent projects and the git repos found on this machine, for the new-thread folder picker.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const fresh = new URL(req.url).searchParams.has("fresh");
    return Response.json({ repos: localRepos({ fresh }) });
  } catch (err) {
    return fail(err, 500);
  }
}
