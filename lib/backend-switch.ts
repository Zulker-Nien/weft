import { endSession, isBusy, sendMessage, setModel } from "./runner";
import { getCard, getThread, updateCard } from "./store";
import type { Backend, Card } from "./types";
import { effortFor, modelOn } from "./new-thread";

// Flips a card from one CLI to the other (right-click menu, rate-limit banner). replay re-sends the
// last user message. Puku-cli doesn't support YOLO, so a switch to puku downgrades bypassPermissions;
// it also doesn't take xhigh effort, so a switch normalizes that through effortFor(). The model goes
// with it: `model` when the picker named one, else the card's own if the new CLI serves it (modelOn).
export async function switchBackend(cardId: string, backend: Backend, { replay = false, model }: { replay?: boolean; model?: string } = {}) {
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  if (card.backend === backend) {
    // Same CLI, another of its models: no new session needed.
    if (model && model !== card.model) setModel(cardId, model);
    return;
  }
  if (isBusy(cardId)) throw new Error("Stop the thread before switching its CLI.");
  await endSession(cardId);
  updateCard(cardId, switchPatch(card, backend, model));
  if (replay) {
    const last = [...getThread(cardId)].reverse().find((item) => item.kind === "user");
    if (last?.kind === "user") sendMessage(cardId, last.text, { echo: false });
  }
}

// What a card changes on its way to another CLI: a fresh session, and the mode, effort and model it can take.
function switchPatch(card: Card, backend: Backend, model: string | undefined): Partial<Card> {
  const patch: Partial<Card> = { backend, sessionId: undefined, rateLimitHit: false };
  if (backend !== "claude" && card.permissionMode === "bypassPermissions") patch.permissionMode = "auto";
  const normalized = effortFor(backend, card.effort);
  if (normalized !== card.effort) patch.effort = normalized;
  const nextModel = modelOn(backend, model ?? card.model);
  if (nextModel !== card.model) patch.model = nextModel;
  return patch;
}
