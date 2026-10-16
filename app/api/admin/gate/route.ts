// Tells the client whether the signed-in Weft account is on the platform
// super-admin allowlist. The check is server-side (the env never reaches the
// bundle); the client just sees { admin: true | false }.
import { isAdminWeft } from "@/lib/admin";
import { fail, guard } from "@/lib/guard";

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  try {
    const admin = await isAdminWeft();
    return Response.json({ admin });
  } catch (err) {
    return fail(err, 500);
  }
}
