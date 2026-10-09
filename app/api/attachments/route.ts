import { saveAttachment } from "@/lib/attachments";
import { fail, guard } from "@/lib/guard";

// Saves a pasted or dropped file. The body is the file itself; x-filename carries its name.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    if (!req.body) throw new Error("No file was sent.");
    const name = decodeURIComponent(req.headers.get("x-filename") ?? "") || "pasted";
    const type = req.headers.get("content-type") ?? "";
    return Response.json(await saveAttachment(req.body, name, type));
  } catch (err) {
    return fail(err);
  }
}
