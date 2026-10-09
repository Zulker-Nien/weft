import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { setKeepAliveMinutes, setThreadPrompt, settingsView } from "@/lib/settings";

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json(settingsView());
}

export async function PATCH(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { threadPrompt?: unknown; keepAliveMinutes?: unknown };

    if (body.threadPrompt !== undefined && typeof body.threadPrompt !== "string") {
      throw new Error("threadPrompt must be text.");
    }
    if (
      body.keepAliveMinutes !== undefined &&
      (typeof body.keepAliveMinutes !== "number" || !Number.isFinite(body.keepAliveMinutes) || body.keepAliveMinutes < 0)
    ) {
      throw new Error("keepAliveMinutes must be a number of minutes, 0 or more.");
    }

    if (typeof body.threadPrompt === "string") setThreadPrompt(body.threadPrompt);
    if (typeof body.keepAliveMinutes === "number") setKeepAliveMinutes(body.keepAliveMinutes);
    return Response.json(settingsView());
  } catch (err) {
    return fail(err);
  }
}
