// Commands the weft.zip board sends to a Mac (public.cloud_commands, supabase/migrations/*_card_commands.sql).
// Two kinds: start a card in a synced folder (`newCardCommand` → `newCardBody`) and reply to a card's thread
// (`replyCommand` → `replyBody`). The web builds the row, the Mac (lib/cloud-inbox.ts) reads the payload back;
// both live here so the two sides can't drift.
import { backendFor, CODEX_DEFAULT_MODEL } from "./new-thread";
import type { Backend, Effort } from "./types";

export type CloudCommandStatus = "pending" | "claimed" | "done" | "failed";

// What a new card is made from. Not the permission mode: the Mac uses its own default, so the web can't ask
// for a thread that runs without asking.
export interface NewCardPayload {
  prompt: string;
  title?: string;
  backend?: Backend;
  model?: string;
  effort?: Effort | "";
  tags?: string[];
}

// A message typed into a card's thread on the web, for the Mac that runs the card to send as if typed there.
export interface ReplyPayload {
  cardId: string;
  text: string;
}

export type CloudCommandKind = "new_card" | "reply";

// public.cloud_commands.
export interface CloudCommandRow {
  id: string;
  org_id: string;
  created_by: string;
  kind: CloudCommandKind;
  // The Mac that runs it (cloud_cards.owner_device) and the folder it runs in (cloud_cards.folder).
  target_device: string;
  folder: string;
  payload: NewCardPayload | ReplyPayload;
  status: CloudCommandStatus;
  card_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// The columns a client may set when it inserts a command (the rest are the database's).
export type NewCommand = Pick<CloudCommandRow, "org_id" | "kind" | "target_device" | "folder" | "payload">;

// A command is still on its way: the web board shows it until its card turns up.
export const isOpenCommand = (c: Pick<CloudCommandRow, "status">) => c.status === "pending" || c.status === "claimed";

// What the web board's New thread dialog collects.
export interface NewCardForm {
  prompt: string;
  // A model id from MODELS ("" or absent: the CLI's own default). It also says which CLI runs the card.
  model?: string;
  effort?: Effort | "";
}

function backendOf(model: string): Backend | undefined {
  return model === CODEX_DEFAULT_MODEL ? "codex" : backendFor(model);
}

// The row the web inserts for a new card, or null when there is nothing to run (an empty prompt).
export function newCardCommand(target: { orgId: string; device: string; folder: string }, form: NewCardForm): NewCommand | null {
  const prompt = form.prompt.trim();
  if (!prompt) return null;
  const payload: NewCardPayload = { prompt };
  const backend = form.model ? backendOf(form.model) : undefined;
  if (form.model && backend) {
    payload.backend = backend;
    payload.model = form.model;
  }
  if (form.effort) payload.effort = form.effort;
  return { org_id: target.orgId, kind: "new_card", target_device: target.device, folder: target.folder, payload };
}

// The row the web inserts to reply to a card, addressed to the Mac and folder the card runs in; null for an empty reply.
export function replyCommand(target: { orgId: string; device: string; folder: string; cardId: string }, text: string): NewCommand | null {
  const message = text.trim();
  if (!message) return null;
  return { org_id: target.orgId, kind: "reply", target_device: target.device, folder: target.folder, payload: { cardId: target.cardId, text: message } };
}

const text = (v: unknown) => (typeof v === "string" ? v : undefined);

// The request body POST /api/cards takes (lib/new-card.ts), from a command as a Mac reads it. The payload came
// off the network, so only the fields a new card is made from are carried over, each as the type it must be.
export function newCardBody(command: Pick<CloudCommandRow, "folder" | "payload">): Record<string, unknown> {
  // The payload came off the network, so whatever the type says, it is checked here.
  const raw: unknown = command.payload;
  const p: Partial<Record<keyof NewCardPayload, unknown>> = raw && typeof raw === "object" ? raw : {};
  return {
    prompt: text(p.prompt),
    title: text(p.title),
    backend: text(p.backend),
    model: text(p.model),
    effort: text(p.effort),
    tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === "string") : undefined,
    cwd: command.folder,
  };
}

// A reply as a Mac reads it off the network: the card and the text, or null when either is missing.
export function replyBody(command: Pick<CloudCommandRow, "payload">): ReplyPayload | null {
  const raw: unknown = command.payload;
  const p: Partial<Record<keyof ReplyPayload, unknown>> = raw && typeof raw === "object" ? raw : {};
  const cardId = text(p.cardId);
  const message = text(p.text)?.trim();
  return cardId && message ? { cardId, text: message } : null;
}

// A command's prompt for the strip and the reply box: a new card's prompt or a reply's text.
export const commandText = (command: Pick<CloudCommandRow, "payload">): string => {
  const p = command.payload as Partial<NewCardPayload & ReplyPayload>;
  return p.prompt ?? p.text ?? "";
};
