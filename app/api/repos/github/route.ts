import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { githubRepos } from "@/lib/repos";

// The user's GitHub repos, through the gh CLI.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const fresh = new URL(req.url).searchParams.has("fresh");
    return Response.json({ repos: await githubRepos({ fresh }) });
  } catch (err) {
    return fail(err, 502);
  }
}
