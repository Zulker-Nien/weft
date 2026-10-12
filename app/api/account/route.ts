import { connection } from "next/server";
import { accountView, sendMagicLink, signOut, startSignIn } from "@/lib/account";
import { fail, guard } from "@/lib/guard";
import type { AccountProvider } from "@/lib/types";

// Your Weft account: who's signed in, or that no one is.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    return Response.json(await accountView());
  } catch (err) {
    return fail(err, 500);
  }
}

// The origin the board reached this server on; guard() already checked it's this machine.
function origin(req: Request) {
  return `http://${req.headers.get("host")}`;
}

// { action: "oauth", provider } returns the page to open in the system browser; "email" sends a
// magic link; "signout" forgets the session here. Both come back to ./callback.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const text = (key: string) => {
      const value = body[key];
      return typeof value === "string" ? value : "";
    };
    switch (body.action) {
      case "oauth":
        return Response.json({ url: await startSignIn(text("provider") as AccountProvider, origin(req)) });
      case "email":
        await sendMagicLink(text("email"), origin(req));
        return Response.json({ ok: true });
      case "signout":
        await signOut();
        return Response.json({ ok: true });
      default:
        throw new Error("Unknown account action.");
    }
  } catch (err) {
    return fail(err);
  }
}
