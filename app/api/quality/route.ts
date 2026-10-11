import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { measureQuality } from "@/lib/quality";

// Code quality of the project in ?cwd= (the open card's or the selected project's folder), for the
// header badge: coverage, file size, lint lockdown, type safety and guardrails.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const cwd = new URL(req.url).searchParams.get("cwd");
  if (!cwd) return Response.json({ quality: null });
  try {
    return Response.json({ quality: measureQuality(cwd) });
  } catch (err) {
    return fail(err, 500);
  }
}
