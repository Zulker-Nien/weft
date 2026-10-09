import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { readCoverage } from "@/lib/coverage";

// Test coverage of this repo, for the header pie. Null in a packaged app, where there's no source tree.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    return Response.json({ coverage: readCoverage(process.cwd()) });
  } catch (err) {
    return fail(err, 500);
  }
}
