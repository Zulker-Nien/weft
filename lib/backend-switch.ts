import { endSession, isBusy, sendMessage } from "./runner";
import { getCard, getThread, updateCard } from "./store";
import type { Backend, Card } from "./types";
import { effortFor } from "./new-thread";

// Flips a card from one CLI to the other (right-click menu, rate-limit banner). replay re-sends the
// last user message. Puku-cli doesn't support YOLO, so a switch to puku downgrades bypassPermissions;
// it also doesn't take xhigh effort, so a switch normalizes that through effortFor().
export async function switchBackend(cardId: string, backend: Backend, { replay = false }: { replay?: boolean } = {}) {
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  if (card.backend === backend) return;
  if (isBusy(cardId)) throw new Error("Stop the thread before switching its CLI.");
  await endSession(cardId);
  const patch: Partial<Card> = { backend, sessionId: undefined, rateLimitHit: false };
  if (backend !== "claude" && card.permissionMode === "bypassPermissions") patch.permissionMode = "auto";
  const normalized = effortFor(backend, card.effort);
  if (normalized !== card.effort) patch.effort = normalized;
  updateCard(cardId, patch);
  if (replay) {
    const last = [...getThread(cardId)].reverse().find((item) => item.kind === "user");
    if (last?.kind === "user") sendMessage(cardId, last.text, { echo: false });
  }
}