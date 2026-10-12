import { newThreadUrl } from "@/lib/glance";
import { fail, guard } from "@/lib/guard";

// The splash page the browser pane shows beside the New thread dialog.
export function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json({ url: newThreadUrl() });
  } catch (err) {
    return fail(err);
  }
}
