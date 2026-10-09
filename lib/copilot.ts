import os from "node:os";
import { startSessionSync } from "./import";
import { endSession, ensureSpare, warmUp } from "./runner";
import { listProjects } from "./settings";
import { clearThread, createCard, getCard, listCards, updateCard } from "./store";
import { COPILOT_ID } from "./types";

export function ensureCopilot() {
  return (
    getCard(COPILOT_ID) ??
    createCard(
      {
        title: "Copilot",
        prompt: "",
        cwd: os.homedir(),
        backend: "claude",
        permissionMode: "default",
        role: "copilot",
      },
      COPILOT_ID,
    )
  );
}

// Starts a fresh conversation: closes the CLI and forgets the session.
export async function resetCopilot() {
  ensureCopilot();
  await endSession(COPILOT_ID);
  clearThread(COPILOT_ID);
  const card = updateCard(COPILOT_ID, {
    sessionId: undefined,
    column: "backlog",
    costUsd: 0,
    turns: 0,
    lastLine: undefined,
    error: undefined,
    pending: null,
  });
  warmUp(COPILOT_ID);
  return card;
}

const g = globalThis as unknown as { __threadboardPrewarmed?: boolean };

// Once per server start: open the copilot's CLI and a spare in the most recent project, so the
// first message to either doesn't wait for a CLI to start.
export function prewarm() {
  if (g.__threadboardPrewarmed) return;
  g.__threadboardPrewarmed = true;
  // Pick up the user's existing Claude Code sessions as cards, and keep them in sync.
  startSessionSync();
  ensureCopilot();
  warmUp(COPILOT_ID);
  const recent = listProjects()[0]?.path ?? listCards().find((c) => c.role !== "copilot")?.cwd;
  if (recent) ensureSpare(recent);
}
