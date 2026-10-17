import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { readSamples } from "@/lib/limit-history";

// The plan-limit history behind the status strip's burndown chart (lib/limit-history.ts), for one CLI:
// ?backend=claude (the default) or puku.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const backend = new URL(req.url).searchParams.get("backend") || "claude";
  try {
    return Response.json({ samples: readSamples().filter((s) => s.backend === backend) });
  } catch (err) {
    return fail(err, 500);
  }
}
