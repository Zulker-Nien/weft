import { newThreadUrl } from "@/lib/glance";
import { fail, guard } from "@/lib/guard";

// The splash page the browser pane shows beside the New thread dialog.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as { folder?: unknown };
    return Response.json({ url: newThreadUrl(typeof body.folder === "string" ? body.folder : null) });
  } catch (err) {
    return fail(err);
  }
}
