import os from "node:os";
import { connection } from "next/server";
import { firstMessage } from "@/lib/automations";
import { prewarm } from "@/lib/copilot";
import { resolveFolder } from "@/lib/folders";
import { titleFromPrompt } from "@/lib/format";
import { fail, guard } from "@/lib/guard";
import { getItem } from "@/lib/library";
import { projectRoot } from "@/lib/repos";
import { sendMessage } from "@/lib/runner";
import { defaultPermissionMode, listProjects, touchProject } from "@/lib/settings";
import { createCard, getCard, listCards } from "@/lib/store";
import { MODES, type Backend, type Effort, type PermissionMode } from "@/lib/types";

const BACKENDS: Backend[] = ["claude", "puku"];
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

const MODEL_ID = /^[\w.\-\[\]]{1,60}$/;

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  prewarm();
  // The copilot is a thread too, but it has its own window.
  const cards = listCards().filter((c) => c.role !== "copilot");
  // Worktree folders -> their main repo, so the project bar folds them into it.
  const roots: Record<string, string> = {};
  for (const folder of new Set([...cards.map((c) => c.cwd), ...listProjects().map((p) => p.path)])) {
    const root = projectRoot(folder);
    if (root !== folder) roots[folder] = root;
  }
  return Response.json({ cards, home: os.homedir(), roots });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const prompt = String(body.prompt ?? "").trim();
    if (!prompt) throw new Error("Write a prompt for this thread.");
    const title = String(body.title ?? "").trim() || titleFromPrompt(prompt);

    const cwd = resolveFolder(body.cwd);

    const backend = BACKENDS.includes(body.backend as Backend) ? (body.backend as Backend) : "claude";
    const permissionMode = MODES.includes(body.permissionMode as PermissionMode)
      ? (body.permissionMode as PermissionMode)
      : defaultPermissionMode();

    const model = backend === "claude" && typeof body.model === "string" && MODEL_ID.test(body.model) ? body.model : undefined;

    const effort = backend === "claude" && EFFORTS.includes(body.effort as Effort) ? (body.effort as Effort) : undefined;

    // Only a recipe that's really in the library; its runs show on its page.
    const recipeId = typeof body.recipeId === "string" && getItem(body.recipeId)?.kind === "recipe" ? body.recipeId : undefined;

    const card = createCard({ title, prompt, cwd, backend, permissionMode, model, effort, ...(recipeId ? { recipeId } : {}) });
    touchProject(cwd);
    if (body.start) sendMessage(card.id, firstMessage(card));
    return Response.json({ card: getCard(card.id) });
  } catch (err) {
    return fail(err);
  }
}
