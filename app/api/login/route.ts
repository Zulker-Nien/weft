import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { authStatus, cancelLogin, loginRuns, openLoginInTerminal, sendLoginInput, startLogin } from "@/lib/login";
import { retryAfterLogin } from "@/lib/runner";
import type { Backend, LoginView } from "@/lib/types";

const BACKENDS: Backend[] = ["claude", "puku"];
const ACTIONS = ["start", "input", "cancel", "terminal"] as const;
type Action = (typeof ACTIONS)[number];

function currentRun(backend: Backend): LoginView | null {
  return loginRuns().find((run) => run.backend === backend) ?? null;
}

// Each CLI's login status, plus any login in progress or just finished.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const [claude, puku] = await Promise.all([authStatus("claude"), authStatus("puku")]);
  return Response.json({ status: { claude, puku }, runs: loginRuns() });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const backend = body.backend as Backend;
    if (!BACKENDS.includes(backend)) throw new Error("Unknown CLI. Use claude or puku.");
    const action = body.action as Action;
    if (!ACTIONS.includes(action)) throw new Error("Unknown login action.");

    let login: LoginView | null;
    switch (action) {
      case "start":
        // Cards that failed because this CLI wasn't logged in run again once it is.
        login = startLogin(backend, () => retryAfterLogin(backend));
        break;
      case "terminal":
        login = openLoginInTerminal(backend, () => retryAfterLogin(backend));
        break;
      case "input": {
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) throw new Error("Paste the code from the login page first.");
        sendLoginInput(backend, text);
        login = currentRun(backend);
        break;
      }
      case "cancel":
        cancelLogin(backend);
        login = currentRun(backend);
        break;
    }
    return Response.json({ login });
  } catch (err) {
    return fail(err);
  }
}
