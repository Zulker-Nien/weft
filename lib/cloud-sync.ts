// The flusher: subscribes to bus events, drops anything for a folder the user hasn't opted in to, and
// uploads the rest to Supabase through the outbox (lib/cloud-outbox.ts). Nothing in the bus handler does
// network work — it appends to the jsonl and arms a flush — so a turn never waits on the cloud.
// The async flush reads the live card/thread from the store (not the event payload, which may be stale),
// rewrites blob references, splits long tool results into cloud_tool_outputs, and drops what it shipped.
// Errors keep their entries, back off exponentially, and warn once per streak. Re-entrancy is guarded
// by an inFlight flag; a trigger that lands mid-flush just sets dirty.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { appendOutbox, compactOutbox, readOutbox, replaceOutboxHead } from "./cloud-outbox";
import {
  TOOL_RESULT_INLINE_MAX,
  type BlobStore,
  type CloudCardRow,
  type CloudThreadItemRow,
  type CloudToolOutputRow,
  type OutboxEntry,
} from "./cloud-sync-types";
import { deviceId } from "./device-id";
import { globalSingleton } from "./global-singleton";
import { syncFolders } from "./settings";
import { getCard, getThread, listCards } from "./store";
import type { BoardEvent, ThreadItem } from "./types";
import type { CloudSyncStatus } from "./cloud-sync-view";
import { subscribe } from "./bus";

const FLUSH_INTERVAL_MS = 10_000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;

export interface CloudSyncOptions {
  blobs: BlobStore;
  // Defaults to accountClient(); null = signed out (the caller chooses to inject a fake).
  client?: () => SupabaseClient | null;
  // Defaults to Date.now; tests pin it.
  now?: () => number;
}

// A live view of the outbox + the last flush, polled by the Sync page (lib/use-cloud-sync.ts).
// (The shape lives in lib/types.ts so the client can import it without pulling in this server-only module.)

interface SyncState {
  inFlight: boolean;
  dirty: boolean;
  backoffMs: number;
  // Set after a failure streak has been logged once; cleared on the first success.
  warnedThisStreak: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  // Each signed-in user's personal org, so a flush doesn't re-query and a new account gets its own.
  orgs: Map<string, string | null>;
  // Has startCloudSync run yet? syncNow / queueFolder are no-ops without it, so a board with no
  // settings.json (or no opt-in folders) can still be probed.
  started: boolean;
  // The blob store the bus listener bound; syncNow / queueFolder share it through the state, so
  // a triggered flush can still rewrite item paths the same way the bus path does.
  blobs: BlobStore | null;
  // The clock the bus listener bound; same reason as blobs.
  now: () => number;
  // Set when the last flush found no account, so the Sync page can say "Sign in to Weft to sync".
  lastSignedOut: boolean;
  // Set when the last flush found an account but no workspace yet.
  lastNoWorkspace: boolean;
  // The last successful flush's end time (unix ms).
  lastSyncAt: number | null;
  // Items uploaded since cloud sync started.
  uploaded: number;
  // The last error's message; cleared on the next success.
  lastError: string | null;
  // The client the bus listener bound; syncNow / queueFolder share it through the state, so
  // a triggered flush uses the same account / fake the listener was given. Defaults to safeAccountClient.
  getClient: () => SupabaseClient | null;
}

function safeAccountClient(): SupabaseClient | null {
  try {
    return accountClient();
  } catch {
    return null;
  }
}

const freshState = (): SyncState => ({
  inFlight: false,
  dirty: false,
  backoffMs: 0,
  warnedThisStreak: false,
  timer: null,
  orgs: new Map(),
  started: false,
  blobs: null,
  now: Date.now,
  lastSignedOut: false,
  lastNoWorkspace: false,
  lastSyncAt: null,
  uploaded: 0,
  lastError: null,
  getClient: safeAccountClient,
});

const state = () => globalSingleton("__weftCloudSync", freshState);

interface Ctx {
  s: SyncState;
  getClient: () => SupabaseClient | null;
  blobs: BlobStore;
  now: () => number;
}

export function startCloudSync(opts: CloudSyncOptions): () => void {
  const s = state();
  const getClient = opts.client ?? safeAccountClient;
  const ctx: Ctx = { s, getClient, blobs: opts.blobs, now: opts.now ?? Date.now };
  // The blob store, clock and client live on the singleton too, so syncNow / queueFolder (called
  // without a ctx) arm a flush the bus listener's flush can actually serve.
  s.blobs = opts.blobs;
  s.now = opts.now ?? Date.now;
  s.getClient = getClient;
  s.started = true;
  // The bus listener is sync: it appends to the outbox and arms a flush. No network here.
  const stop = subscribe((event: BoardEvent) => {
    const entries = entriesForEvent(event, ctx.now());
    if (!entries.length || !cardInSyncedFolder(event)) return;
    appendOutbox(entries);
    // A turn's end flushes now; anything else waits for the tick, so a streaming turn is one batch, not hundreds.
    if (event.type !== "thread" || event.item.kind === "result") trigger(ctx);
  });
  // The tick flushes whatever piled up since the last one, and picks up entries left from before a restart.
  // The backoff timer (set on a previous error) takes precedence: the tick is a no-op while it's set.
  const tick = setInterval(() => {
    if (!ctx.s.timer && readOutbox().length) trigger(ctx);
  }, FLUSH_INTERVAL_MS);
  return () => {
    stop();
    clearInterval(tick);
    clearTimer(ctx.s);
    // The next start (in this process) sees a clean state. The status fields stay so a re-mount of the
    // Sync page doesn't briefly show "never synced".
    s.started = false;
    s.inFlight = false;
    s.dirty = false;
  };
}

function cardInSyncedFolder(event: BoardEvent): boolean {
  const folders = syncFolders();
  if (!folders.length) return false;
  if (event.type === "card") return folders.includes(event.card.cwd);
  if (event.type === "card_deleted") return true; // the card is gone; the flush checks what it knew.
  // Only thread events are left: entriesForEvent gives nothing for the other kinds.
  const card = event.type === "thread" ? getCard(event.cardId) : undefined;
  return !!card && folders.includes(card.cwd);
}

// A thread event with truncate replaces the item at index and drops everything after it (a rewind, an edit with ↑).
function entriesForEvent(event: BoardEvent, at: number): OutboxEntry[] {
  if (event.type === "card") return [{ op: "card", cardId: event.card.id, at }];
  if (event.type === "card_deleted") return [{ op: "card_deleted", cardId: event.id, at }];
  if (event.type !== "thread") return [];
  const item: OutboxEntry = { op: "item", cardId: event.cardId, seq: event.index, at };
  return event.truncate ? [{ op: "truncate", cardId: event.cardId, seq: event.index + 1, at }, item] : [item];
}

function clearTimer(s: SyncState) {
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
}

function trigger(ctx: Ctx, delay = 0) {
  if (ctx.s.inFlight) {
    ctx.s.dirty = true;
    return;
  }
  clearTimer(ctx.s);
  ctx.s.timer = setTimeout(() => void flush(ctx), delay);
}

async function flush(ctx: Ctx) {
  const { s } = ctx;
  s.timer = null;
  s.inFlight = true;
  try {
    const raw = readOutbox();
    if (!raw.length) return;
    const pending = compactOutbox(raw);
    // Write the compacted list back first, so the file stays small while signed out or offline.
    if (pending.length < raw.length) replaceOutboxHead(raw.length, pending);
    const client = ctx.getClient();
    if (!client) {
      s.lastSignedOut = true;
      s.lastNoWorkspace = false;
      return; // signed out: keep entries, no backoff (signing in is a user action).
    }
    const userId = await currentUserId(client);
    if (!userId) {
      s.lastSignedOut = true;
      s.lastNoWorkspace = false;
      return;
    }
    const orgId = await resolveOrgId(s, client, userId);
    if (!orgId) {
      s.lastSignedOut = false;
      s.lastNoWorkspace = true;
      return; // no workspace yet: keep entries, no backoff.
    }
    s.lastSignedOut = false;
    s.lastNoWorkspace = false;
    const uploaded = await uploadPending(ctx, client, orgId, pending);
    replaceOutboxHead(pending.length, []);
    s.uploaded += uploaded;
    s.lastSyncAt = ctx.now();
    s.lastError = null;
    s.backoffMs = 0;
    s.warnedThisStreak = false;
  } catch (err) {
    // A failure keeps the entries and bumps the backoff. The warning fires once until the next success.
    const message = err instanceof Error ? err.message : String(err);
    if (!s.warnedThisStreak) {
      console.warn(`Cloud sync failed: ${message}`);
      s.warnedThisStreak = true;
    }
    s.lastError = message;
    s.backoffMs = Math.min(s.backoffMs ? s.backoffMs * 2 : 1_000, BACKOFF_MAX_MS);
    s.dirty = false;
    s.inFlight = false;
    trigger(ctx, s.backoffMs);
    return;
  }
  s.inFlight = false;
  if (s.dirty) {
    s.dirty = false;
    trigger(ctx);
  }
}

async function currentUserId(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.auth.getSession();
  return data.session?.user.id ?? null;
}

// The first org this user owns: their personal workspace.
async function resolveOrgId(s: SyncState, client: SupabaseClient, userId: string): Promise<string | null> {
  if (s.orgs.has(userId)) return s.orgs.get(userId) ?? null;
  const { data, error } = await client
    .from("org_memberships")
    .select("org_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ org_id: string }>();
  if (error) throw error;
  const org = data?.org_id ?? null;
  s.orgs.set(userId, org);
  return org;
}

// Cards first (items reference them), then deletes and truncates, then items and tool outputs in one upsert each.
// Returns the number of items shipped — every entry that was actually uploaded, not the outbox count.
async function uploadPending(ctx: Ctx, client: SupabaseClient, orgId: string, pending: OutboxEntry[]): Promise<number> {
  const cards = cardRows(ctx, orgId, pending);
  if (cards.length) check(await client.from("cloud_cards").upsert(cards));
  for (const entry of pending) {
    // The row keeps the card json it last uploaded; a card that never synced matches no row.
    if (entry.op === "card_deleted") {
      const at = new Date(ctx.now()).toISOString();
      check(await client.from("cloud_cards").update({ deleted: true, updated_at: at }).eq("org_id", orgId).eq("card_id", entry.cardId));
    }
    if (entry.op === "truncate") {
      check(await client.from("cloud_thread_items").delete().eq("org_id", orgId).eq("card_id", entry.cardId).gte("seq", entry.seq));
    }
  }
  const items: CloudThreadItemRow[] = [];
  const outputs: CloudToolOutputRow[] = [];
  for (const entry of pending) {
    if (entry.op !== "item" || !getCard(entry.cardId)) continue;
    const live = getThread(entry.cardId)[entry.seq];
    if (!live) continue;
    const { item, output } = splitToolResult(await ctx.blobs.rewriteItem(live, orgId));
    items.push({ org_id: orgId, card_id: entry.cardId, seq: entry.seq, kind: item.kind, item, at: new Date(live.at).toISOString() });
    if (output) outputs.push({ org_id: orgId, card_id: entry.cardId, ...output });
  }
  if (outputs.length) check(await client.from("cloud_tool_outputs").upsert(outputs));
  if (items.length) check(await client.from("cloud_thread_items").upsert(items));
  return items.length;
}

// Every live card the batch touches, not just those with a card entry: a card that changed before its folder
// was opted in still needs its row before its items can reference it.
function cardRows(ctx: Ctx, orgId: string, pending: OutboxEntry[]): CloudCardRow[] {
  const ids = new Set(pending.filter((e) => e.op !== "card_deleted").map((e) => e.cardId));
  const rows: CloudCardRow[] = [];
  for (const id of ids) {
    const card = getCard(id);
    if (!card) continue;
    rows.push({
      org_id: orgId,
      card_id: id,
      owner_device: deviceId(),
      folder: card.cwd,
      card,
      deleted: false,
      updated_at: new Date(ctx.now()).toISOString(),
    });
  }
  return rows;
}

// Supabase hands errors back as plain objects; throw them as Errors so the backoff's warning can read them.
function check(result: { error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
}

// Pulls a long tool result out of its item, leaving resultBytes in its place. The full string goes to
// cloud_tool_outputs, keyed by the tool id.
function splitToolResult(item: ThreadItem): { item: ThreadItem; output?: Omit<CloudToolOutputRow, "org_id" | "card_id"> } {
  if (item.kind !== "tool" || !item.result || item.result.length <= TOOL_RESULT_INLINE_MAX) return { item };
  const { result, ...rest } = item;
  return { item: { ...rest, resultBytes: result.length }, output: { tool_id: item.id, result, bytes: result.length } };
}

// A live view for the Sync page (lib/use-cloud-sync.ts): how many outbox entries are waiting, when
// the last flush ended, how many items the outbox has shipped since cloud sync started, and the
// latest failure (cleared on the next success). A status is always safe to read, even before
// startCloudSync runs — `uploaded` is 0 and the rest are null / false.
export function cloudSyncStatus(): CloudSyncStatus {
  const s = state();
  return {
    waiting: readOutbox().length,
    lastSyncAt: s.lastSyncAt,
    uploaded: s.uploaded,
    lastError: s.lastError,
    signedOut: s.lastSignedOut,
    noWorkspace: s.lastNoWorkspace,
  };
}

// A no-op when cloud sync hasn't been started (e.g. a test imported the module but never called
// startCloudSync). With it started, the flush picks up the current outbox straight away; the same
// path the bus listener uses for a `result` item.
export function syncNow() {
  const s = state();
  if (!s.started || !s.blobs) return;
  trigger({ s, getClient: s.getClient, blobs: s.blobs, now: s.now });
}

// queueFolder is the Sync page's "turn this folder on, sync its existing cards" path: it appends
// an outbox entry for every live card and every thread item the folder holds, then arms a flush.
// A no-op for an unknown folder (a card whose cwd never landed in listCards) or before start.
export function queueFolder(folder: string) {
  const s = state();
  if (!s.started || !s.blobs) return;
  const at = s.now();
  const entries: OutboxEntry[] = [];
  for (const card of listCards()) {
    if (card.cwd !== folder) continue;
    entries.push({ op: "card", cardId: card.id, at });
    getThread(card.id).forEach((_, seq) => entries.push({ op: "item", cardId: card.id, seq, at }));
  }
  if (entries.length) appendOutbox(entries);
  trigger({ s, getClient: s.getClient, blobs: s.blobs, now: s.now });
}
