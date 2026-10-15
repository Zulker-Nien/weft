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
import { getCard, getThread } from "./store";
import type { BoardEvent, ThreadItem } from "./types";
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

interface SyncState {
  inFlight: boolean;
  dirty: boolean;
  backoffMs: number;
  // Set after a failure streak has been logged once; cleared on the first success.
  warnedThisStreak: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  // Each signed-in user's personal org, so a flush doesn't re-query and a new account gets its own.
  orgs: Map<string, string | null>;
}

const freshState = (): SyncState => ({
  inFlight: false,
  dirty: false,
  backoffMs: 0,
  warnedThisStreak: false,
  timer: null,
  orgs: new Map(),
});

const state = () => globalSingleton("__weftCloudSync", freshState);

interface Ctx {
  s: SyncState;
  getClient: () => SupabaseClient | null;
  blobs: BlobStore;
  now: () => number;
}

export function startCloudSync(opts: CloudSyncOptions): () => void {
  const ctx: Ctx = { s: state(), getClient: opts.client ?? safeAccountClient, blobs: opts.blobs, now: opts.now ?? Date.now };
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
  };
}

function cardInSyncedFolder(event: BoardEvent): boolean {
  const folders = syncFolders();
  if (!folders.length) return false;
  if (event.type === "card") return folders.includes(event.card.cwd);
  if (event.type === "card_deleted") return true; // the card is gone; the flush checks what it knew.
  if (event.type === "thread") {
    const card = getCard(event.cardId);
    return !!card && folders.includes(card.cwd);
  }
  return false;
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
    if (!client) return; // signed out: keep entries, no backoff (signing in is a user action).
    const userId = await currentUserId(client);
    if (!userId) return;
    const orgId = await resolveOrgId(s, client, userId);
    if (!orgId) return; // no workspace yet: keep entries, no backoff.
    await uploadPending(ctx, client, orgId, pending);
    replaceOutboxHead(pending.length, []);
    s.backoffMs = 0;
    s.warnedThisStreak = false;
  } catch (err) {
    // A failure keeps the entries and bumps the backoff. The warning fires once until the next success.
    if (!s.warnedThisStreak) {
      console.warn(`Cloud sync failed: ${err instanceof Error ? err.message : String(err)}`);
      s.warnedThisStreak = true;
    }
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

function safeAccountClient(): SupabaseClient | null {
  try {
    return accountClient();
  } catch {
    return null;
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
async function uploadPending(ctx: Ctx, client: SupabaseClient, orgId: string, pending: OutboxEntry[]) {
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
