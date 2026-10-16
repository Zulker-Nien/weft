// Picks up the user's existing Claude Code sessions (the ones /resume and the Claude app list) as
// cards, keeps them in sync, and loads a session's transcript into its thread when it's opened.
//
// Split for size:
// - lib/import-files.ts: scanning session files and reading their tail (parseTitle, sessionFiles,
//   readTail, lastPermissionMode)
// - lib/import-ps.ts: scanning processes for live sessions (isOpenElsewhere, releaseSession,
//   openSessions)
// - lib/import-sync.ts: the sync loop that turns sessions into cards (runSync, syncSessions,
//   startSessionSync, checkLive)
// This file holds the bits callers reach for: the mode a session continues in (sessionMode),
// the transcript loader (loadTranscript), and re-exports of the rest so the public API of
// `./import` doesn't change.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { replaceThread, getThread, updateCard } from "./store";
import { transcriptToThread } from "./transcript";
import { toPermissionMode, type Card, type PermissionMode } from "./types";
import { lastPermissionMode } from "./import-files";

const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

// The user's default mode for new Claude Code sessions (permissions.defaultMode).
function defaultMode(): PermissionMode | undefined {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "settings.json"), "utf8")) as { permissions?: { defaultMode?: unknown } | null } | null;
    return toPermissionMode(settings?.permissions?.defaultMode);
  } catch {
    return undefined;
  }
}

// The mode a picked-up session continues in: the one it last ran in, so resuming it doesn't start
// asking about every command. The tail usually has it; otherwise the file's start, then the user's
// default, then "default".
export function sessionMode(file: string | undefined, tailMode?: PermissionMode): PermissionMode {
  if (tailMode) return tailMode;
  if (file) {
    try {
      const fd = fs.openSync(file, "r");
      try {
        const buffer = Buffer.alloc(256 * 1024);
        const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
        const mode = lastPermissionMode(buffer.subarray(0, read).toString("utf8"));
        if (mode) return mode;
      } finally {
        fs.closeSync(fd);
      }
    } catch {}
  }
  return defaultMode() ?? "default";
}

// Reads a picked-up session's transcript into its thread, when it changed since the last read.
export async function loadTranscript(card: Card) {
  if (card.source !== "claude-code" || !card.sessionId || card.warm) return;
  const activity = card.lastActivity ?? card.updatedAt;
  if (card.transcriptAt && card.transcriptAt >= activity && getThread(card.id).length) return;
  const cwdExists = fs.existsSync(card.cwd);
  const messages = await getSessionMessages(card.sessionId, cwdExists ? { dir: card.cwd } : undefined);
  replaceThread(card.id, transcriptToThread(messages, { cwd: card.cwd }));
  updateCard(card.id, { transcriptAt: activity });
}

export { isOpenElsewhere, releaseSession } from "./import-ps";
export { lastPermissionMode, parseTitle, readTail, sessionFiles } from "./import-files";
export { startSessionSync, syncSessions, type SyncResult } from "./import-sync";