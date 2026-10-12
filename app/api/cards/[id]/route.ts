import { firstMessage, messagesForMove } from "@/lib/automations";
import { resolveFolder } from "@/lib/folders";
import { asText } from "@/lib/format";
import { fail, guard } from "@/lib/guard";
import { archiveWhenIdle, endSession, isBusy, queueMessages, sendMessage, setPermissionMode } from "@/lib/runner";
import { dismissSession } from "@/lib/settings";
import { deleteCard, getCard, updateCard } from "@/lib/store";
import { rememberTags } from "@/lib/tag-store";
import { normalizeTags } from "@/lib/tags";
import { COLUMNS, MODES, type Card, type Column, type PermissionMode } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

// Running and Needs you follow the thread's live state, so they can't be set by hand.
const MANUAL: Column[] = ["backlog", "review", "done"];

// ★ (a starred card is never auto-archived) and tags. Tags you set stay yours: retitle stops picking them (lib/tags.ts).
function setMarks(id: string, body: { starred?: unknown; tags?: unknown }) {
  if (body.starred !== undefined) updateCard(id, { starred: Boolean(body.starred) });
  if (body.tags === undefined) return;
  if (!Array.isArray(body.tags)) throw new Error("Tags must be a list.");
  const tags = normalizeTags(body.tags.map((t) => asText(t)));
  updateCard(id, { tags, tagsBy: "user" });
  // New ones join the catalog (lib/tag-store.ts), so they stay listed.
  rememberTags(tags);
}

// Your drag to another column (Running only from Backlog; Needs you never by hand).
function moveCard(card: Card, column: Column) {
  if (!COLUMNS.some((c) => c.id === column)) throw new Error("Unknown column.");
  if (card.role === "copilot") throw new Error("The copilot isn't on the board.");
  // A turn waiting on you can be parked in Backlog, Review or Done; answering it later runs it on.
  const waiting = Boolean(card.pending) && MANUAL.includes(column);
  if (isBusy(card.id) && !waiting) throw new Error("Stop the thread before moving it.");
  if (column === "running") {
    if (card.column !== "backlog") throw new Error("Reply in the thread to run it again.");
    sendMessage(card.id, firstMessage(card));
  } else if (MANUAL.includes(column)) {
    updateCard(card.id, { column });
    // Your own move runs that column's automations (Settings), such as weft:done for Done.
    queueMessages(card.id, messagesForMove(card, column));
    // Done files the card away once its automations (weft:done) have run.
    if (column === "done") archiveWhenIdle(card.id);
    else updateCard(card.id, { archived: false });
  } else {
    throw new Error("Cards move to Needs you on their own.");
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const card = getCard(id);
    if (!card) return fail("No such card.", 404);
    const body = (await req.json()) as {
      column?: Column;
      title?: unknown;
      cwd?: string;
      archived?: unknown;
      starred?: unknown;
      tags?: unknown;
      permissionMode?: PermissionMode;
    };

    if (body.title !== undefined) {
      const title = asText(body.title).trim();
      if (title) updateCard(id, { title, titleBy: "user" });
    }

    if (body.archived !== undefined) {
      if (card.role === "copilot") throw new Error("The copilot isn't on the board.");
      updateCard(id, { archived: Boolean(body.archived) });
    }

    setMarks(id, body);

    // Takes effect mid-turn too: the open CLI switches modes right away.
    if (body.permissionMode !== undefined) {
      if (!MODES.includes(body.permissionMode)) throw new Error("Unknown permission mode.");
      // Only board threads on Claude Code start with the flag that lets them skip every prompt.
      if (body.permissionMode === "bypassPermissions" && (card.role === "copilot" || card.backend !== "claude")) {
        throw new Error("This thread can't skip permission prompts.");
      }
      setPermissionMode(id, body.permissionMode);
    }

    // Re-points a thread whose folder moved or was renamed.
    if (body.cwd !== undefined) {
      if (isBusy(id)) throw new Error("Stop the thread before moving its folder.");
      updateCard(id, { cwd: resolveFolder(body.cwd), error: undefined });
    }

    if (body.column && body.column !== card.column) moveCard(card, body.column);
    return Response.json({ card: getCard(id) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (getCard(id)?.role === "copilot") return fail("The copilot can't be deleted. Start a new chat instead.");
  const card = getCard(id);
  await endSession(id);
  // A picked-up session stays deleted; the sync won't bring it back.
  if (card?.source === "claude-code" && card.sessionId) dismissSession(card.sessionId);
  deleteCard(id);
  return Response.json({ ok: true });
}
