import { connection } from "next/server";
import { cachedGithubProfile, githubProfile } from "@/lib/github-profile";
import { fail, guard } from "@/lib/guard";
import { sessionsToImport, syncSessions } from "@/lib/import";
import { importAll, saveWelcome, setCountHistory, testingWelcome, testWelcome, welcomeOrAdopt } from "@/lib/welcome";
import { welcomePreview } from "@/lib/welcome-preview";

// First launch's welcome (lib/welcome.ts). GET says whether it's waiting and, if so, what its two
// screens show (?replay=1 shows them anyway, from every session, for Settings → General's replay);
// POST answers it and runs the import; PATCH is Settings → General changing it later, or testing it
// (the real welcome again, over every session, since a used board has few left to bring in).
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const replay = new URL(req.url).searchParams.get("replay") === "1";
    const welcome = welcomeOrAdopt();
    if (welcome && !replay) return Response.json({ welcome });
    const [cards, github] = await Promise.all([sessionsToImport({ all: replay || testingWelcome() }), githubProfile().catch(() => cachedGithubProfile())]);
    return Response.json({ welcome, preview: { ...welcomePreview(cards), github } });
  } catch (err) {
    return fail(err, 500);
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => null)) as { countHistory?: unknown; fresh?: unknown; skip?: unknown } | null;
    if (!body || typeof body.countHistory !== "boolean" || typeof body.fresh !== "boolean") return fail(new Error("countHistory and fresh are required"));
    const skip = Array.isArray(body.skip) ? body.skip.filter((s): s is string => typeof s === "string" && s.startsWith("/")) : [];
    const welcome = { at: Date.now(), countHistory: body.countHistory, fresh: body.fresh, skip };
    saveWelcome(welcome);
    void syncSessions().catch((err: unknown) => console.error("Session sync failed:", err));
    return Response.json({ welcome });
  } catch (err) {
    return fail(err, 500);
  }
}

export async function PATCH(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => null)) as { countHistory?: unknown; importAll?: unknown; test?: unknown } | null;
    if (typeof body?.countHistory === "boolean") setCountHistory(body.countHistory);
    else if (body?.test === true) testWelcome();
    else if (body?.importAll === true) {
      importAll();
      void syncSessions().catch((err: unknown) => console.error("Session sync failed:", err));
    } else return fail(new Error("countHistory, importAll or test is required"));
    return Response.json({ welcome: welcomeOrAdopt() });
  } catch (err) {
    return fail(err, 500);
  }
}
