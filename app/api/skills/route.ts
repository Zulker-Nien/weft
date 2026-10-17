import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { listSkills } from "@/lib/skills";

// The skills a thread can run: Weft's own, yours in ~/.claude/skills, and with ?cwd= that folder's.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const cwd = new URL(req.url).searchParams.get("cwd") || undefined;
    return Response.json({ skills: listSkills(cwd) });
  } catch (err) {
    return fail(err);
  }
}
