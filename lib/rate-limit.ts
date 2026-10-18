import { recordLimit } from "./activity";
import { getCard, updateCard } from "./store";
import { BACKEND_LABELS, type Backend } from "./types";
import { hitFrom } from "./usage";

// A plan-limit error parks the card in needs_you with rateLimitHit set, so the card menu and the
// rate-limit banner can offer a one-click escape to the other CLI.
// It's logged for the limit badges: the window the message names, else the one the card saw full.
export function hitRateLimit(cardId: string, backend: Backend, message: string) {
  const card = getCard(cardId);
  if (!card) return;
  const now = Date.now();
  const hit = hitFrom(message, now);
  const named = hit && /week|session|5.hour|opus|sonnet/i.test(message);
  const kind = named ? hit.kind : (card.stats?.sevenDay?.used ?? 0) >= 100 ? "seven_day" : hit?.kind;
  if (kind) recordLimit(kind, now, card);
  updateCard(cardId, { column: "needs_you", pending: null, error: message, rateLimitHit: true, lastLine: `${BACKEND_LABELS[backend]} hit its plan limit` });
}