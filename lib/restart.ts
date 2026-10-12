import { retry, isBusy } from "./runner";
import { getThread } from "./store";

// The Restart button on a stopped or failed card: its last message again, in a fresh CLI (runner.retry).
export async function restartTurn(cardId: string) {
  if (isBusy(cardId)) throw new Error("This thread is already running.");
  if (!getThread(cardId).some((item) => item.kind === "user")) throw new Error("This thread has no message to run again.");
  await retry(cardId);
}
