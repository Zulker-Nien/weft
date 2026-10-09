import os from "node:os";
import { connection } from "next/server";
import { prewarm } from "@/lib/copilot";
import { resolveFolder } from "@/lib/folders";
import { fail, guard } from "@/lib/guard";
import { sendMessage } from "@/lib/runner";
import { touchProject } from "@/lib/settings";
import { createCard, getCard, listCards } from "@/lib/store";
import type { Backend, PermissionMode } from "@/lib/types";

const BACKENDS: Backend[] = ["claude", "puku"];
const MODES: PermissionMode[] = ["default", "acceptEdits", "auto"];

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  prewarm();
  // The copilot is a thread too, but it has its own window.
  const cards = listCards().filter((c) => c.role !== "copilot");
  return Response.json({ cards, home: os.homedir() });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const prompt = String(body.prompt ?? "").trim();
    if (!prompt) throw new Error("Write a prompt for this thread.");
    const title = String(body.title ?? "").trim() || prompt.split("\n")[0].slice(0, 60);

    const cwd = resolveFolder(body.cwd);

    const backend = BACKENDS.includes(body.backend as Backend) ? (body.backend as Backend) : "claude";
    const permissionMode = MODES.includes(body.permissionMode as PermissionMode)
      ? (body.permissionMode as PermissionMode)
      : "default";

    const card = createCard({ title, prompt, cwd, backend, permissionMode });
    touchProject(cwd);
    if (body.start) sendMessage(card.id, prompt);
    return Response.json({ card: getCard(card.id) });
  } catch (err) {
    return fail(err);
  }
}
