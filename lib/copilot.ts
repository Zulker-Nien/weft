import os from "node:os";
import { reapStrayClis } from "./cli-reaper";
import { startSessionSync } from "./import";
import { startSearchIndex } from "./search";
import { boardDigest, lastSeen, rememberSeen, snapshot, withDigest } from "./copilot-digest";
import { startHookListener } from "./github-hooks";
import { startVercelListener } from "./vercel-hooks";
import { startWebhookRelay } from "./webhook-forward";
import { startIssueSync } from "./github-issues";
import { startPukuTrial } from "./puku-trial";
import { endSession, ensureSpare, retryPukuWithTrial, sendUserMessage, warmUp } from "./runner";
import { resumeInterrupted } from "./resume";
import { startScheduler } from "./scheduler";
import { defaultPermissionMode, listProjects } from "./settings";
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
        permissionMode: defaultPermissionMode(),
        role: "copilot",
      },
      COPILOT_ID,
    )
  );
}

// A message you typed to the copilot. Its CLI also gets what finished, needs you or failed on the
// board since your last message; the thread shows only your text.
export function sendToCopilot(text: string) {
  const cards = listCards();
  const digest = boardDigest(cards, lastSeen(), getCard(COPILOT_ID)?.lastWeftTurn);
  sendUserMessage(COPILOT_ID, text, { cli: withDigest(digest, text) });
  rememberSeen(snapshot(cards));
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
  // End the thread CLIs a server that died without cleaning up left orphaned (lib/cli-reaper.ts).
  const folders = [...new Set([...listProjects().map((p) => p.path), ...listCards().map((c) => c.cwd)].filter(Boolean))];
  reapStrayClis(folders).catch((err: unknown) => console.error("[weft] stray CLI check failed:", err));
  // Pick up the user's existing Claude Code sessions as cards, and keep them in sync.
  startSessionSync();
  startSearchIndex();
  // Send the messages queued for a set time (lib/scheduler.ts), including any that came due while closed.
  startScheduler();
  // Sync the GitHub issues of the folders that opted in, every 5 minutes (lib/github-issues.ts).
  startIssueSync();
  // Hear webhook-relayed issue events within seconds, while you're signed in to Weft (lib/github-hooks.ts).
  startHookListener();
  // Pull new Vercel env variables into the 🔐 vault as their webhook events arrive (lib/vercel-hooks.ts).
  startVercelListener();
  // Forward what providers post to your webhooks' relay URLs to their local targets (lib/webhook-forward.ts).
  startWebhookRelay();
  // Keep Weft's Puku trial token fresh, and give puku threads waiting on a login the trial when you sign in to Weft.
  startPukuTrial(() => void retryPukuWithTrial());
  // Carry on the turns the last quit cut off (lib/resume.ts).
  resumeInterrupted();
  ensureCopilot();
  warmUp(COPILOT_ID);
  const recent = listProjects()[0]?.path ?? listCards().find((c) => c.role !== "copilot")?.cwd;
  if (recent) ensureSpare(recent);
}
