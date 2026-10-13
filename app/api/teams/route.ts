// The Weft teams JSON API on weft.zip (docs/architecture/teams.md). GET reads
// the snapshot for a workspace (defaulting to the user's current workspace),
// POST applies a mutation from a TeamOp body. Both take an Authorization:
// Bearer <jwt> header; the JWT is the desktop's Supabase access token, so
// the desktop's local board can call us on the user's behalf without that
// machine ever holding a cookie for weft.zip.
//
// No localhost guard: like /api/puku/v1, this is the deployed site's public
// API; the bearer token is the check. A Weft without SUPABASE_SECRET_KEY
// answers 503 (the auth check isn't meaningful without it). The same route
// also runs in `next dev` when the secret is set, so the tests can exercise
// it from a local browser without needing a Vercel deployment.
//
// Connection is awaited so prerendering under cacheComponents doesn't try
// to fold the route into a static response; reading `req.url` already opts
// out, but the explicit await is what the Next docs ask for.
import { connection } from "next/server";
import { z } from "zod";
import { SUPABASE_KEY } from "@/lib/supabase-project";
import { teamSnapshot, runTeamOp } from "@/lib/team-ops";
import { currentWorkspaceFor, teamAccessFor } from "@/lib/teams";
import { TEAM_ROLES, type TeamOp, type TeamRole } from "@/lib/team-types";
import { bearerUser } from "@/lib/web-session";

// The route reads the request — cacheComponents is on, so we mark it dynamic.
export const dynamic = "force-dynamic";

// 503 is the right answer for "the deployment isn't set up" so callers
// (the desktop, an integration test) can distinguish from 401/404.
function unconfigured() {
  return Response.json({ error: "unconfigured" }, { status: 503 });
}

// 401 for a missing/invalid bearer; 404 for "you're not a member of this
// workspace" (or it doesn't exist). The message strings match what the
// desktop's forwarder / the board hook expect — see lib/use-team.ts.
async function authAndAccess(req: Request, orgSlug: string | null) {
  if (!SUPABASE_KEY) return { kind: "unconfigured" as const };
  const user = await bearerUser(req);
  if (!user) return { kind: "signed-out" as const };
  // ?org omitted → use the user's current workspace, healing a stale
  // pointer the same way the cookie path does.
  let slug = orgSlug;
  if (!slug) {
    const ws = await currentWorkspaceFor(user);
    if (ws.kind !== "ok") return { kind: "signed-out" as const };
    slug = ws.slug;
  }
  const access = await teamAccessFor(user, slug);
  if (access.kind === "signed-out") return { kind: "signed-out" as const };
  if (access.kind !== "ok") return { kind: "denied" as const };
  return { kind: "ok" as const, ctx: access.ctx, slug };
}

// Parse a POST body into a TeamOp. Anything malformed (a missing field, a role that isn't one, a foreign action)
// returns null, so the route answers 400 { error: "bad-request" }.
const text = z.string().min(1);
const role = z.enum(TEAM_ROLES as [TeamRole, ...TeamRole[]]);
const TeamOpSchema = z.discriminatedUnion("action", [
  z.object({ org: text, action: z.literal("invite"), email: text, role }),
  z.object({ org: text, action: z.literal("role"), userId: text, role }),
  z.object({ org: text, action: z.literal("remove"), userId: text }),
  z.object({ org: text, action: z.literal("revoke"), inviteId: text }),
]);

function parseOp(value: unknown): TeamOp | null {
  const parsed = TeamOpSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  const orgSlug = url.searchParams.get("org");
  const auth = await authAndAccess(req, orgSlug);
  if (auth.kind === "unconfigured") return unconfigured();
  if (auth.kind === "signed-out") return Response.json({ error: "signed-out" }, { status: 401 });
  if (auth.kind === "denied") return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json(await teamSnapshot(auth.ctx));
}

export async function POST(req: Request) {
  await connection();
  let op: TeamOp | null = null;
  try {
    op = parseOp(await req.json());
  } catch {
    op = null;
  }
  if (!op) return Response.json({ error: "bad-request" }, { status: 400 });
  const auth = await authAndAccess(req, op.org);
  if (auth.kind === "unconfigured") return unconfigured();
  if (auth.kind === "signed-out") return Response.json({ error: "signed-out" }, { status: 401 });
  if (auth.kind === "denied") return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json(await runTeamOp(auth.ctx, op));
}