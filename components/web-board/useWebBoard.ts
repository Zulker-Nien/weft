"use client";

// The weft.zip board's data: the org's cards, the open card's thread window and its signed blob URLs,
// kept live through Supabase Realtime. The browser client is the visitor's own cookie session
// (@supabase/ssr's createBrowserClient with the publishable key), so RLS gates both the reads and the
// Realtime stream: the same SELECT policy that gates a read gates what postgres_changes sends.
import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { newCardCommand, type CloudCommandRow, type NewCardForm } from "@/lib/cloud-commands";
import { BLOB_BUCKET, THREAD_PAGE_SIZE, type CloudCardRow, type CloudThreadItemRow } from "@/lib/cloud-sync-types";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase-project";
import {
  applyCardChange,
  applyItemChange,
  batchBlobRefs,
  blobPath,
  buildBlobUrlMap,
  seqOf,
  windowFromItems,
  type WebBoardThread,
} from "@/lib/web-board";
import { applyCommandChange, type CloudCommandChange, type WebTarget } from "@/lib/web-commands";

// The status of the Realtime channel; the dot beside the title reflects it.
export type LiveStatus = "connecting" | "live" | "offline";

export interface WebBoardInput {
  orgId: string;
  // The signed-in visitor, to tell their own commands from a teammate's.
  userId: string;
  // Their commands that haven't finished (or failed) when the page loaded.
  initialCommands: CloudCommandRow[];
  initialCards: CloudCardRow[];
  openCardId: string | null;
  initialThread: CloudThreadItemRow[];
  initialBlobUrls: Record<string, string>;
}

type Change<Row> = { eventType: "INSERT" | "UPDATE" | "DELETE"; new: Row | null; old: Partial<Row> | null };

// Supabase types a change as a generic payload; the row shapes are lib/cloud-sync-types'.
function changeOf<Row>(payload: { eventType: string; new: unknown; old: unknown }): Change<Row> | null {
  const change: Change<Row> = {
    eventType: payload.eventType as Change<Row>["eventType"],
    new: (payload.new as Row | null) ?? null,
    old: (payload.old as Partial<Row> | null) ?? null,
  };
  return change.new || change.old ? change : null;
}

// Resolve blob refs to signed URLs, 50 to a call. A batch that fails is skipped; the renderer leaves
// the ref visible instead of crashing.
async function signedUrls(client: SupabaseClient, orgId: string, refs: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const batch of batchBlobRefs(refs)) {
    try {
      const { data, error } = await client.storage.from(BLOB_BUCKET).createSignedUrls(batch.map((r) => blobPath(orgId, r)), 3600);
      if (error) continue;
      Object.assign(out, buildBlobUrlMap(data.map((d: { path: string | null; signedUrl: string | null }) => ({ path: d.path ?? "", signedUrl: d.signedUrl })), batch));
    } catch {
      // Skip the batch.
    }
  }
  return out;
}

export function useWebBoard({ orgId, userId, initialCommands, initialCards, openCardId, initialThread, initialBlobUrls }: WebBoardInput) {
  const [cards, setCards] = useState<CloudCardRow[]>(initialCards);
  const [activeCardId, setActiveCardId] = useState<string | null>(openCardId);
  // The open card's thread, newest first, with blob refs still as refs: the panel rewrites them from
  // `blobUrls` as it draws, so an item that arrives live shows its picture once its URL lands.
  const [thread, setThread] = useState<WebBoardThread | null>(openCardId ? windowFromItems(openCardId, initialThread) : null);
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>(initialBlobUrls);
  const [commands, setCommands] = useState<CloudCommandRow[]>(initialCommands);
  const [live, setLive] = useState<LiveStatus>("connecting");
  const [client] = useState<SupabaseClient>(() => createBrowserClient(SUPABASE_URL, SUPABASE_KEY));
  // Refs already asked for, so one that never resolves isn't asked for again on every change.
  const asked = useRef(new Set(Object.keys(initialBlobUrls)));
  // The card the latest open asked for; a slow earlier fetch must not replace it.
  const latestOpen = useRef<string | null>(openCardId);
  // Commands this tab sent: only these open their card when done, not one sent from another tab.
  const sent = useRef(new Set<string>());
  // The card a command made, to open once its row has synced back (the command is "done" a moment before that).
  const openWhenSeen = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const channel: RealtimeChannel = client
      .channel(`web-board-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cloud_cards", filter: `org_id=eq.${orgId}` }, (payload: { eventType: string; new: unknown; old: unknown }) => {
        const change = changeOf<CloudCardRow>(payload);
        if (cancelled || !change) return;
        setCards((prev) => applyCardChange(prev, change as Parameters<typeof applyCardChange>[1]));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cloud_thread_items", filter: `org_id=eq.${orgId}` }, (payload: { eventType: string; new: unknown; old: unknown }) => {
        const change = changeOf<CloudThreadItemRow>(payload);
        if (cancelled || !change) return;
        setThread((prev) => (prev ? applyItemChange(prev, { eventType: change.eventType, new: change.new ?? undefined, old: change.old ?? undefined }) : prev));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cloud_commands", filter: `org_id=eq.${orgId}` }, (payload: { eventType: string; new: unknown; old: unknown }) => {
        const change = changeOf<CloudCommandRow>(payload);
        if (cancelled || !change) return;
        // A teammate's commands are theirs to follow.
        if (change.new && change.new.created_by !== userId) return;
        if (change.new?.status === "done" && change.new.card_id && sent.current.delete(change.new.id)) openWhenSeen.current = change.new.card_id;
        setCommands((prev) => applyCommandChange(prev, change as CloudCommandChange));
      })
      .subscribe((status: string) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") setLive("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setLive("offline");
      });
    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [client, orgId, userId]);

  // Whatever refs the window names that have no URL yet.
  const refs = thread?.blobRefs;
  useEffect(() => {
    const missing = (refs ?? []).filter((r) => !asked.current.has(r));
    if (!missing.length) return;
    for (const r of missing) asked.current.add(r);
    let cancelled = false;
    void signedUrls(client, orgId, missing).then((map) => {
      if (!cancelled && Object.keys(map).length) setBlobUrls((prev) => ({ ...prev, ...map }));
    });
    return () => {
      cancelled = true;
    };
  }, [client, orgId, refs]);

  const setCardParam = useCallback((cardId: string | null) => {
    const url = new URL(window.location.href);
    if (cardId) url.searchParams.set("card", cardId);
    else url.searchParams.delete("card");
    window.history.replaceState(null, "", url.toString());
  }, []);

  // Open a card: its newest page of thread, and the URL, so the panel is linkable and survives a refresh.
  const openCard = useCallback(
    async (cardId: string) => {
      latestOpen.current = cardId;
      setActiveCardId(cardId);
      setCardParam(cardId);
      const { data, error } = await client
        .from("cloud_thread_items")
        .select("*")
        .eq("org_id", orgId)
        .eq("card_id", cardId)
        .order("seq", { ascending: false })
        .limit(THREAD_PAGE_SIZE)
        .overrideTypes<CloudThreadItemRow[]>();
      if (latestOpen.current !== cardId) return;
      setThread(error ? { cardId, items: [], hasOlder: false, blobRefs: [] } : windowFromItems(cardId, data));
    },
    [client, orgId, setCardParam],
  );

  const closeCard = useCallback(() => {
    latestOpen.current = null;
    setActiveCardId(null);
    setThread(null);
    setCardParam(null);
  }, [setCardParam]);

  // Page back from the oldest item the window holds.
  const loadOlder = useCallback(async () => {
    if (!thread?.hasOlder) return;
    const oldest = thread.items[thread.items.length - 1];
    const before = oldest ? seqOf(oldest) : undefined;
    if (before === undefined) return;
    const { data, error } = await client
      .from("cloud_thread_items")
      .select("*")
      .eq("org_id", orgId)
      .eq("card_id", thread.cardId)
      .lt("seq", before)
      .order("seq", { ascending: false })
      .limit(THREAD_PAGE_SIZE)
      .overrideTypes<CloudThreadItemRow[]>();
    if (error) return;
    const older = windowFromItems(thread.cardId, data);
    setThread((prev) =>
      prev && prev.cardId === thread.cardId
        ? { ...prev, hasOlder: older.hasOlder, items: [...prev.items, ...older.items], blobRefs: [...new Set([...prev.blobRefs, ...older.blobRefs])] }
        : prev,
    );
  }, [client, orgId, thread]);

  // Asks the Mac that owns `target` to start a card (lib/cloud-inbox.ts runs it). Resolves to why it couldn't be
  // sent, or null once the command is in; the card turns up on the board by itself when the Mac has made it.
  const startCard = useCallback(
    async (target: WebTarget, form: NewCardForm): Promise<string | null> => {
      const row = newCardCommand({ orgId, device: target.device, folder: target.folder }, form);
      if (!row) return "Write a prompt first.";
      const { data, error } = await client.from("cloud_commands").insert(row).select().single<CloudCommandRow>();
      if (error) return error.message;
      sent.current.add(data.id);
      setCommands((prev) => applyCommandChange(prev, { eventType: "INSERT", new: data, old: null }));
      return null;
    },
    [client, orgId],
  );

  // Takes a command back before the Mac has run it, or clears one that failed. A delete the database refuses
  // leaves it where it is.
  const dropCommand = useCallback(
    async (id: string) => {
      const { error } = await client.from("cloud_commands").delete().eq("id", id);
      if (!error) setCommands((prev) => prev.filter((c) => c.id !== id));
    },
    [client],
  );

  // A started card opens as soon as it is on the board: when its command says done, or its row lands.
  useEffect(() => {
    const id = openWhenSeen.current;
    if (!id || !cards.some((c) => c.card_id === id)) return;
    openWhenSeen.current = null;
    void openCard(id);
  }, [cards, commands, openCard]);

  // The full result of a tool call whose result was cut out of its item (cloud_tool_outputs).
  const toolOutput = useCallback(
    async (cardId: string, toolId: string) => {
      const { data, error } = await client
        .from("cloud_tool_outputs")
        .select("result")
        .eq("org_id", orgId)
        .eq("card_id", cardId)
        .eq("tool_id", toolId)
        .maybeSingle<{ result: string }>();
      if (error || !data) throw error ?? new Error("no output");
      return data.result;
    },
    [client, orgId],
  );

  return { cards, commands, activeCardId, thread, blobUrls, live, openCard, closeCard, loadOlder, toolOutput, startCard, dropCommand };
}
