import { firstMessage, messagesForMove } from "@/lib/automations";
import { resolveFolder } from "@/lib/folders";
import { fail, guard } from "@/lib/guard";
import { archiveWhenIdle, endSession, isBusy, queueMessages, sendMessage, setPermissionMode } from "@/lib/runner";
import { dismissSession } from "@/lib/settings";
import { deleteCard, getCard, updateCard } from "@/lib/store";
import { COLUMNS, MODES, type Column, type PermissionMode } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

// Running and Needs you follow the thread's live state, so they can't be set by hand.
const MANUAL: Column[] = ["backlog", "review", "done"];

export async function PATCH(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const card = getCard(id);
    if (!card) return fail("No such card.", 404);
    const body = (await req.json()) as {
      column?: Column;
      title?: string;
      cwd?: string;
      archived?: boolean;
      permissionMode?: PermissionMode;
    };

    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (title) updateCard(id, { title, titleBy: "user" });
    }

    if (body.archived !== undefined) {
      if (card.role === "copilot") throw new Error("The copilot isn't on the board.");
      updateCard(id, { archived: Boolean(body.archived) });
    }

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

    if (body.column && body.column !== card.column) {
      if (!COLUMNS.some((c) => c.id === body.column)) throw new Error("Unknown column.");
      if (card.role === "copilot") throw new Error("The copilot isn't on the board.");
      if (isBusy(id)) throw new Error("Stop the thread before moving it.");
      if (body.column === "running") {
        if (card.column !== "backlog") throw new Error("Reply in the thread to run it again.");
        sendMessage(id, firstMessage(card));
      } else if (MANUAL.includes(body.column)) {
        updateCard(id, { column: body.column });
        // Your own move runs that column's automations (Settings), such as weft:done for Done.
        queueMessages(id, messagesForMove(card, body.column));
        // Done files the card away once its automations (weft:done) have run.
        if (body.column === "done") archiveWhenIdle(id);
        else updateCard(id, { archived: false });
      } else {
        throw new Error("Cards move to Needs you on their own.");
      }
    }
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
