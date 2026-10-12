import { getCard, updateCard } from "./store";
import { BACKEND_LABELS, type Backend } from "./types";

// A plan-limit error parks the card in needs_you with rateLimitHit set, so the card menu and the
// rate-limit banner can offer a one-click escape to the other CLI.
export function hitRateLimit(cardId: string, backend: Backend, message: string) {
  if (getCard(cardId)) updateCard(cardId, { column: "needs_you", pending: null, error: message, rateLimitHit: true, lastLine: `${BACKEND_LABELS[backend]} hit its plan limit` });
}