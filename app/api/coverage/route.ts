import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { findCoverage } from "@/lib/coverage";

// Test coverage of the project in ?cwd= (the open card's or the selected project's folder), for the
// header pie. Null when that project has no `coverage/coverage-summary.json`.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const cwd = new URL(req.url).searchParams.get("cwd");
  if (!cwd) return Response.json({ coverage: null });
  try {
    return Response.json({ coverage: findCoverage(cwd) });
  } catch (err) {
    return fail(err, 500);
  }
}
