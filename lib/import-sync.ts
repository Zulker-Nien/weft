// The sync loop: walks every Claude Code session, decides what each one's card should
// be doing now, and applies that to the board.

import { randomUUID } from "node:crypto";
import os from "node:os";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { dismissedSessions } from "./settings";
import { firstLine } from "./format";
import { addCards, listCards, updateCard } from "./store";
import { type Card, type Column } from "./types";
import { LIVE_LINES, g, liveCards, type Tail } from "./import-state";
import { openSessions } from "./import-ps";
import { parseTitle, readTail, sessionFiles, sessionMode } from "./import";
import { importsSession, welcomeOrAdopt } from "./welcome";

const RECENT_MS = 3 * 24 * 60 * 60_000;
// A session mid-turn counts as running if it changed this recently, even when no open app shows it.
const RUNNING_QUIET_MS = 2 * 60_000;
const TEMP_DIRS = [os.tmpdir(), "/tmp/", "/private/tmp/", "/private/var/folders/"];

function columnFor(stage: string | undefined, lastActivity: number, live?: Column): Column {
  if (live) return live;
  if (stage === "Done") return "done";
  if (stage) return "review";
  return Date.now() - lastActivity < RECENT_MS ? "review" : "done";
}

// Where a session that's live in another app belongs: Running while a turn runs, Needs you while it
// waits for an answer there. Without Claude Code's report, an unfinished turn in the session file
// counts if the session is open or changed in the last two minutes (a CLI that quit mid-turn leaves
// its last turn unfinished for good).
function liveColumn(sessionId: string, tail: Tail | undefined, open: { ids: Set<string>; status: Map<string, "busy" | "idle" | "waiting"> }): Column | undefined {
  const status = open.status.get(sessionId);
  if (status) return status === "busy" ? "running" : status === "waiting" ? "needs_you" : undefined;
  return tail?.busy && (open.ids.has(sessionId) || Date.now() - tail.at < RUNNING_QUIET_MS) ? "running" : undefined;
}

// Moves a picked-up card when its session changed outside Weft, or went live or quiet there.
// Otherwise it stays where the user put it. Weft's own runs (warm) and pending requests are left alone.
function columnPatch(card: Card, activity: number, live: Column | undefined, stage = card.stage, reply?: string): Partial<Card> {
  if (card.warm || card.pending) return {};
  const outside = activity > (card.lastActivity ?? 0) + 1000;
  if (!outside && !live && !liveCards.has(card.id)) return {};
  if (live) liveCards.add(card.id);
  else liveCards.delete(card.id);
  const column = columnFor(stage, activity, live);
  const patch: Partial<Card> = column === card.column ? {} : { column };
  const line = live ? LIVE_LINES[live] : reply;
  if (line && line !== card.lastLine) patch.lastLine = line;
  return patch;
}

export interface SyncResult {
  sessions: number;
  added: number;
  updated: number;
  // A new install whose welcome isn't answered yet: no cards are added until it is (lib/welcome.ts).
  waiting?: boolean;
}

// What the sessions say right now: cards for sessions not on the board yet (every session with `all`),
// and the changes to the cards that are. Nothing is applied here.
async function scanSessions(all = false): Promise<{ sessions: number; fresh: Card[]; patches: [string, Partial<Card>][] }> {
  const [sessions, open] = await Promise.all([
    listSessions({ includeProgrammatic: false, limit: 10_000 }),
    openSessions(),
  ]);
  const files = sessionFiles();
  const cards = indexCards();
  const dismissed = new Set(dismissedSessions());
  const fresh: Card[] = [];
  const patches: [string, Partial<Card>][] = [];

  for (const session of sessions) {
    const { kind, card, patch } = classifySession(session, { files, open, cards, dismissed, all });
    if (kind === "fresh" && card) fresh.push(card);
    else if (kind === "patch" && card && patch) patches.push([card.id, patch]);
  }
  return { sessions: sessions.length, fresh, patches };
}

type SessionInfo = ReturnType<typeof listSessions> extends Promise<infer R> ? R extends Array<infer S> ? S : never : never;
interface ClassifyContext {
  files: Map<string, string>;
  open: Awaited<ReturnType<typeof openSessions>>;
  cards: Map<string, Card>;
  dismissed: Set<string>;
  all: boolean;
}

// One session's verdict: a new card, a patch to an existing card, or a skip. Lifted out of scanSessions
// to keep the loop small and the rule for each kind (tooling, dismissed, ours, forked) easy to read.
function classifySession(
  session: SessionInfo,
  { files, open, cards, dismissed, all }: ClassifyContext,
): { kind: "fresh" | "patch" | "skip"; card?: Card; patch?: Partial<Card> } {
  if (dismissed.has(session.sessionId)) return { kind: "skip" };
  // Sessions in temporary folders are tooling runs (tests, subagents), not the user's threads.
  if (TEMP_DIRS.some((dir) => (session.cwd ?? "").startsWith(dir))) return { kind: "skip" };
  const tail = readSessionTail(files, session.sessionId);
  const activity = tail?.at || session.createdAt || session.lastModified;
  const { title, stage } = parseTitle(session.customTitle || session.summary || session.firstPrompt || "Untitled thread");
  const openElsewhere = open.ids.has(session.sessionId);
  const live = liveColumn(session.sessionId, tail, open);
  const file = files.get(session.sessionId);
  const existing = cards.get(session.sessionId);
  if (!existing || all) {
    return { kind: "fresh", card: newCardFromSession(session, { title, stage, activity, openElsewhere, live, file, tail }) };
  }
  // Weft's own cards, and cards that continued a session as a copy, don't follow the original.
  if (existing.source !== "claude-code" || existing.forkedFrom === session.sessionId) return { kind: "skip" };
  const patch = patchForExisting(existing, { title, stage, activity, openElsewhere, live, tail });
  return Object.keys(patch).length ? { kind: "patch", card: existing, patch } : { kind: "skip" };
}

async function runSync(): Promise<SyncResult> {
  const { sessions, fresh, patches } = await scanSessions();
  for (const [id, patch] of patches) updateCard(id, patch);
  const w = welcomeOrAdopt();
  const added = fresh.filter((c) => importsSession(w, c.cwd, c.lastActivity ?? c.createdAt));
  if (added.length) addCards(added);
  return { sessions, added: added.length, updated: patches.length, ...(w ? {} : { waiting: true }) };
}

// The cards the sync would add if nothing held it back, for the welcome's preview (lib/welcome-preview.ts);
// with `all`, a card for every session, on the board or not, for replaying the welcome.
export async function sessionsToImport({ all = false } = {}): Promise<Card[]> {
  return (await scanSessions(all)).fresh;
}

function indexCards(): Map<string, Card> {
  const cards = new Map<string, Card>();
  for (const c of listCards()) {
    if (c.sessionId) cards.set(c.sessionId, c);
    if (c.forkedFrom) cards.set(c.forkedFrom, c);
  }
  return cards;
}

function readSessionTail(files: Map<string, string>, sessionId: string) {
  const file = files.get(sessionId);
  return file ? readTail(file) : undefined;
}

// What a brand-new card should look like for this session, before the loop adds it.
function newCardFromSession(
  session: { sessionId: string; cwd?: string; firstPrompt?: string; createdAt?: number },
  { title, stage, activity, openElsewhere, live, file, tail }: { title: string; stage?: string; activity: number; openElsewhere: boolean; live: Column | undefined; file: string | undefined; tail: ReturnType<typeof readTail> },
): Card {
  return {
    id: randomUUID(),
    title,
    prompt: session.firstPrompt ?? "",
    cwd: session.cwd ?? os.homedir(),
    backend: "claude",
    permissionMode: sessionMode(file, tail?.mode),
    column: columnFor(stage, activity, live),
    sessionId: session.sessionId,
    stage,
    source: "claude-code",
    lastActivity: activity,
    openElsewhere,
    lastLine: (live && LIVE_LINES[live]) || (session.firstPrompt ? firstLine(session.firstPrompt) : undefined),
    createdAt: session.createdAt ?? activity,
    updatedAt: activity,
  };
}

// What a card the user already has should look like now: column/lastLine when the session moved
// outside Weft or went live or quiet, and stage/title/lastActivity when it picked up new messages.
function patchForExisting(
  existing: Card,
  { title, stage, activity, openElsewhere, live, tail }: { title: string; stage?: string; activity: number; openElsewhere: boolean; live: Column | undefined; tail: ReturnType<typeof readTail> },
): Partial<Card> {
  const patch: Partial<Card> = {};
  if (Boolean(existing.openElsewhere) !== openElsewhere) patch.openElsewhere = openElsewhere;
  // New messages or a new title from outside Weft move the card, unless Weft has the thread open.
  Object.assign(patch, columnPatch(existing, activity, live, stage, tail?.reply));
  const outside = activity > (existing.lastActivity ?? 0) + 1000;
  // A title you or Weft's retitle chose (lib/retitle.ts) stays; only the stage follows Claude Code.
  const name = existing.titleBy ? {} : { title };
  if (outside && !existing.warm) {
    Object.assign(patch, { stage, lastActivity: activity }, name);
  } else if (!existing.warm && (stage !== existing.stage || (!existing.titleBy && title !== existing.title))) {
    Object.assign(patch, { stage }, name);
  }
  return patch;
}

// One sync at a time; callers share the one in progress.
export function syncSessions(): Promise<SyncResult> {
  g.__weftSync ??= runSync().finally(() => {
    g.__weftSync = undefined;
  });
  return g.__weftSync as Promise<SyncResult>;
}

// A quick look between full syncs, so a session that starts or ends a turn in another app, or stops
// there to ask the user something, moves its card within seconds.
async function checkLive() {
  if (g.__weftSync) return;
  const files = sessionFiles();
  const open = await openSessions();
  for (const card of listCards()) {
    if (card.source !== "claude-code" || !card.sessionId || card.forkedFrom) continue;
    const file = files.get(card.sessionId);
    const tail = file ? readTail(file) : undefined;
    if (!tail) continue;
    const patch = columnPatch(card, tail.at, liveColumn(card.sessionId, tail, open), card.stage, tail.reply);
    if (!card.warm && tail.at > (card.lastActivity ?? 0) + 1000) patch.lastActivity = tail.at;
    if (Boolean(card.openElsewhere) !== open.ids.has(card.sessionId)) patch.openElsewhere = open.ids.has(card.sessionId);
    if (Object.keys(patch).length) updateCard(card.id, patch);
  }
}

// Syncs now and then every minute, once per server process, checking for live sessions in between.
export function startSessionSync() {
  if (g.__weftSyncTimer) return;
  g.__weftSyncTimer = setInterval(() => void syncSessions().catch(() => {}), 60_000);
  g.__weftCheckTimer = setInterval(() => void checkLive().catch(() => {}), 5_000);
  void syncSessions().catch((err: unknown) => console.error("Session sync failed:", err));
}
