import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { searchPrompts } from "@/lib/search";

// Searches the prompts the user wrote, in the cards that are on the board.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    return Response.json(searchPrompts(q));
  } catch (err) {
    return fail(err, 500);
  }
}
