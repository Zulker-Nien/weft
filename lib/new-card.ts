import { firstMessage } from "./automations";
import { resolveFolder } from "./folders";
import { asText, cleanTitle, titleFromPrompt } from "./format";
import { effortFor } from "./new-thread";
import { sendMessage } from "./runner";
import { defaultPermissionMode, touchProject } from "./settings";
import { createCard } from "./store";
import { rememberTags } from "./tag-store";
import { normalizeTags } from "./tags";
import { MODES, type Backend, type Card, type Effort, type PermissionMode } from "./types";

// Making a card from a request body: POST /api/cards (the New thread dialog) and the cloud inbox (a card
// started on the weft.zip board, lib/cloud-inbox.ts) both go through here, so a card reads the same either way.

const BACKENDS: Backend[] = ["claude", "puku", "codex"];

const MODEL_ID = /^[\w.\-\[\]]{1,60}$/;

// Throws with a message to show when the body can't make a card (no prompt, a folder that isn't one).
export function createCardFromBody(body: Record<string, unknown>): Card {
  const prompt = asText(body.prompt).trim();
  if (!prompt) throw new Error("Write a prompt for this thread.");
  const typedTitle = cleanTitle(asText(body.title));
  const title = typedTitle || titleFromPrompt(prompt);

  const cwd = resolveFolder(body.cwd);

  const backend = BACKENDS.includes(body.backend as Backend) ? (body.backend as Backend) : "claude";
  const permissionMode = MODES.includes(body.permissionMode as PermissionMode)
    ? (body.permissionMode as PermissionMode)
    : defaultPermissionMode();

  const model = typeof body.model === "string" && MODEL_ID.test(body.model) ? body.model : undefined;

  const effort = effortFor(backend, body.effort as Effort | "");

  // Tags given here are yours, so retitle won't pick others (lib/retitle.ts); new ones join the catalog.
  const tags = Array.isArray(body.tags) ? normalizeTags(body.tags.map((t) => asText(t))) : [];
  rememberTags(tags);

  const card = createCard({
    title,
    ...(typedTitle ? { titleBy: "user" as const } : {}),
    prompt,
    cwd,
    backend,
    permissionMode,
    model,
    effort,
    ...(tags.length ? { tags, tagsBy: "user" as const } : {}),
  });
  touchProject(cwd);
  return card;
}

// Sends the card's prompt (plus the skills a "thread starts" rule names) as its first turn.
export function startCard(card: Card) {
  sendMessage(card.id, firstMessage(card));
}
