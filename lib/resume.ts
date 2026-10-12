import { sendMessage } from "./runner";
import { listCards, updateCard } from "./store";

// What a cut-off thread is told when Weft starts again. It shows in the thread, so you see why it moved.
export const RESUME_TEXT =
  "Weft restarted while this turn was running, so it was cut off. Check what you already finished, then pick up where you left off.";

// Carries on each turn the app closed in the middle of (lib/store.ts marks them on load). A card with no
// session yet has nothing to continue, so it stays stopped in Review (Resume all restarts it), as does one whose folder is gone.
export function resumeInterrupted() {
  for (const card of listCards()) {
    if (!card.interrupted) continue;
    if (!card.sessionId || card.archived || card.role === "copilot") {
      updateCard(card.id, { interrupted: undefined });
      continue;
    }
    try {
      // Read before sending: a new turn clears the count.
      const resumes = (card.resumes ?? 0) + 1;
      sendMessage(card.id, RESUME_TEXT);
      updateCard(card.id, { resumes });
    } catch (err) {
      updateCard(card.id, { interrupted: undefined, error: `Couldn't resume after the restart: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
}
