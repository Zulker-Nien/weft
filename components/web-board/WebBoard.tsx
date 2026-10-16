"use client";

// The weft.zip board at /[orgSlug]/board: a live mirror of the desktop's opted-in cards. Server
// hands it the org id, the visitor's signed-in user id, the initial card rows and the initial
// thread (when a card is open). It subscribes to Supabase Realtime, renders the five columns,
// and opens a side panel for the card the user picks.
//
// The browser client is the visitor's own cookie session (lib/web-board.ts builds it through
// @supabase/ssr's createBrowserClient with the publishable key), so RLS gates both the initial
// read and the Realtime stream. RLS does pass through Realtime for SELECT policies on tables in
// the `supabase_realtime` publication — that's how the same select policy that gates /thread
// also gates the postgres_changes stream.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { BLOB_BUCKET, BLOB_REF_PREFIX, THREAD_PAGE_SIZE, type CloudCardRow, type CloudThreadItemRow } from "@/lib/cloud-sync-types";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase-project";
import type { ThreadItem } from "@/lib/types";
import {
  applyCardChange,
  applyItemChange,
  batchBlobRefs,
  blobPath,
  buildBlobUrlMap,
  collectBlobRefs,
  folderName,
  groupCardsByColumn,
  toolOutputSummary,
  windowFromItems,
  rewriteWindowBlobRefs,
  type WebBoardCard as WebBoardCardShape,
  type WebBoardColumn as WebBoardColumnShape,
} from "@/lib/web-board";
import { WebBoardCard } from "./WebBoardCard";
import { WebBoardSidePanel } from "./WebBoardSidePanel";

// What the server hands in. The thread is keyed by the open card id (or null when no card is
// open); the blob URLs are pre-resolved for the initial render.
export interface WebBoardProps {
  orgId: string;
  orgSlug: string;
  initialCards: CloudCardRow[];
  openCardId: string | null;
  initialThread: CloudThreadItemRow[];
  initialBlobUrls: Record<string, string>;
}

type ThreadWindow = ReturnType<typeof windowFromItems>;

// The status of the Realtime channel — the small dot beside the title reflects it.
type LiveStatus = "connecting" | "live" | "offline";

export function WebBoard({ orgId, orgSlug, initialCards, openCardId, initialThread, initialBlobUrls }: WebBoardProps) {
  // The list of cards, kept in sync with Realtime. `initialCards` is the server's first read.
  const [cards, setCards] = useState<CloudCardRow[]>(initialCards);
  // The currently-open card id (mirrors the ?card= search param so a reload keeps the same view).
  const [activeCardId, setActiveCardId] = useState<string | null>(openCardId);
  // The thread window for the open card, plus a copy of the card's metadata so the panel header
  // can show its title without a second fetch.
  const [thread, setThread] = useState<ThreadWindow | null>(
    openCardId
      ? rewriteWindowBlobRefs(windowFromItems(openCardId, initialThread, null), initialBlobUrls)
      : null,
  );
  // The cached blob url table — a new card opens with the initial map, and a refetch replaces
  // it. The side panel also fires a "load older" page through the same map.
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>(initialBlobUrls);
  const [live, setLive] = useState<LiveStatus>("connecting");
  // A shared Supabase client — created once per mount and reused by every Realtime callback.
  // The browser client, with the visitor's cookie session under the hood. createBrowserClient
  // reads the cookies from `document.cookie` and lets the project URL/anon key stand in for
  // SERVICE_ROLE — RLS still gates every read, and a memberless visitor just sees nothing.
  // useState's lazy initializer is the React-19-friendly way to make a long-lived client.
  const [client] = useState<SupabaseClient>(() => createBrowserClient(SUPABASE_URL, SUPABASE_KEY));

  // The five columns, derived. Recomputing on every Realtime event is fine; the card set is
  // bounded by an org's synced cards, and the sort is stable.
  const columns: WebBoardColumnShape[] = useMemo(() => groupCardsByColumn(cards), [cards]);

  // Live: subscribe to INSERT/UPDATE/DELETE on cloud_cards and cloud_thread_items for this org.
  // The filter tells Realtime which rows to send, but the project's RLS still enforces what
  // actually lands in the visitor's session.
  useEffect(() => {
    let cancelled = false;
    const channel: RealtimeChannel = client
      .channel(`web-board-${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cloud_cards", filter: `org_id=eq.${orgId}` },
        (payload: { eventType: string; new: unknown; old: unknown }) => {
          if (cancelled) return;
          // Supabase types the change as a generic payload; we know the row shape from
          // lib/cloud-sync-types. Cast so applyCardChange can stay strictly typed.
          const change: { eventType: "INSERT" | "UPDATE" | "DELETE"; new: CloudCardRow | null; old: Partial<CloudCardRow> | null } = {
            eventType: payload.eventType as "INSERT" | "UPDATE" | "DELETE",
            new: (payload.new as CloudCardRow | null) ?? null,
            old: (payload.old as Partial<CloudCardRow> | null) ?? null,
          };
          if (!change.new && !change.old) return;
          setCards((prev) => applyCardChange(prev, change as { eventType: "INSERT" | "UPDATE" | "DELETE"; new: CloudCardRow; old: Partial<CloudCardRow> | null }));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cloud_thread_items", filter: `org_id=eq.${orgId}` },
        (payload: { eventType: string; new: unknown; old: unknown }) => {
          if (cancelled) return;
          const change: { eventType: "INSERT" | "UPDATE" | "DELETE"; new: CloudThreadItemRow | null; old: Partial<CloudThreadItemRow> | null } = {
            eventType: payload.eventType as "INSERT" | "UPDATE" | "DELETE",
            new: (payload.new as CloudThreadItemRow | null) ?? null,
            old: (payload.old as Partial<CloudThreadItemRow> | null) ?? null,
          };
          if (!change.new && !change.old) return;
          setThread((prev) => {
            if (!prev) return prev;
            return applyItemChange(prev, {
              eventType: change.eventType,
              new: change.new ?? undefined,
              old: change.old ?? undefined,
            });
          });
        },
      )
      .subscribe((status: string) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") setLive("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setLive("offline");
      });
    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [client, orgId]);

  // Open a card: refetch the thread (newest 50) through the visitor's client, resolve the
  // blob refs, and update the URL so the side panel is linkable / survives a refresh.
  const openCard = useCallback(
    async (cardId: string) => {
      setActiveCardId(cardId);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("card", cardId);
        window.history.replaceState(null, "", url.toString());
      }
      const { data, error } = await client
        .from("cloud_thread_items")
        .select("*")
        .eq("org_id", orgId)
        .eq("card_id", cardId)
        .order("seq", { ascending: false })
        .limit(THREAD_PAGE_SIZE)
        .overrideTypes<CloudThreadItemRow[]>();
      if (error) {
        setThread({ cardId, items: [], hasOlder: false, blobRefs: [] });
        return;
      }
      const w = windowFromItems(cardId, data, null);
      // Resolve every blob ref the page needs to render. Multiple cards worth of refs can pile
      // up if the user flips between them, so the map is the long-lived cache.
      const next = await resolveBlobUrls(client, orgId, w.blobRefs, blobUrls);
      setBlobUrls(next);
      setThread(rewriteWindowBlobRefs(w, next));
    },
    [client, orgId, blobUrls],
  );

  // Close the panel and clear the ?card= param.
  const closeCard = useCallback(() => {
    setActiveCardId(null);
    setThread(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("card");
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  // "Load older" for the open card: page backward from the oldest item in the current window.
  const loadOlder = useCallback(async () => {
    if (!thread || !thread.hasOlder) return;
    const oldest = thread.items[thread.items.length - 1];
    if (!oldest) return;
    const seq = (oldest as unknown as { __seq?: number }).__seq ?? null;
    const beforeSeq = seq ?? null;
    const { data, error } = await client
      .from("cloud_thread_items")
      .select("*")
      .eq("org_id", orgId)
      .eq("card_id", thread.cardId)
      .lt("seq", beforeSeq ?? Number.MAX_SAFE_INTEGER)
      .order("seq", { ascending: false })
      .limit(THREAD_PAGE_SIZE)
      .overrideTypes<CloudThreadItemRow[]>();
    if (error) return;
    const older = windowFromItems(thread.cardId, data, beforeSeq);
    const next = await resolveBlobUrls(client, orgId, older.blobRefs, blobUrls);
    setBlobUrls(next);
    setThread({
      ...older,
      items: [...thread.items, ...older.items],
      blobRefs: [...thread.blobRefs, ...older.blobRefs],
    });
  }, [client, orgId, thread, blobUrls]);

  // The card's title and folder for the side panel header — pulled from the live cards list.
  const activeCard = activeCardId ? cards.find((c) => c.card_id === activeCardId) : null;
  const activeMeta = activeCard
    ? {
        id: activeCard.card_id,
        title: activeCard.card.title,
        folder: activeCard.folder,
        ownerDevice: activeCard.owner_device,
        card: activeCard.card,
        updatedAt: activeCard.updated_at,
      }
    : null;

  return (
    <div className="wz-boardPage">
      <header className="wz-boardHeader">
        <div>
          <h1 className="wz-boardTitle">Board</h1>
          <p className="wz-boardSub">
            The cards your team has synced to <strong>{orgSlug}</strong>.
          </p>
        </div>
        <LiveDot status={live} />
      </header>

      {cards.length === 0 ? (
        <p className="wz-boardEmpty">
          No synced cards yet. Cards show here once a project&apos;s <strong>Sync to workspace</strong> switch
          is on in the desktop app&apos;s GitHub drawer.
        </p>
      ) : (
        <div className="wz-boardColumns">
          {columns.map((col) => (
            <WebBoardColumn key={col.id} column={col} activeCardId={activeCardId} onOpen={(id) => void openCard(id)} />
          ))}
        </div>
      )}

      {activeCardId && activeMeta && thread ? (
        <WebBoardSidePanel
          meta={activeMeta}
          window={thread}
          blobUrls={blobUrls}
          onClose={() => closeCard()}
          onLoadOlder={() => void loadOlder()}
        />
      ) : null}
    </div>
  );
}

function LiveDot({ status }: { status: LiveStatus }) {
  const label = status === "live" ? "Live" : status === "connecting" ? "Connecting…" : "Offline";
  return (
    <span className="wz-boardLive" aria-live="polite">
      <span className={`wz-boardLiveDot${status === "live" ? "" : " wz-boardLiveDot-off"}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function WebBoardColumn({ column, activeCardId, onOpen }: { column: WebBoardColumnShape; activeCardId: string | null; onOpen: (id: string) => void }) {
  return (
    <div className="wz-boardColumn">
      <div className="wz-boardColumnHead">
        <span>{column.label}</span>
        <span className="wz-boardColumnCount">{column.cards.length}</span>
      </div>
      {column.cards.map((card: WebBoardCardShape) => (
        <WebBoardCard key={card.id} entry={card} active={card.id === activeCardId} onOpen={onOpen} />
      ))}
    </div>
  );
}

// Resolve a batch of blob refs to signed URLs through createSignedUrls. The map is the long-lived
// cache; the same ref keeps its URL across re-renders. Errors fall through silently and the
// renderer leaves the ref as-is so the user sees a missing image instead of a crash.
async function resolveBlobUrls(client: SupabaseClient, orgId: string, refs: readonly string[], current: Record<string, string>): Promise<Record<string, string>> {
  const out: Record<string, string> = { ...current };
  const missing = refs.filter((r) => !current[r]);
  if (!missing.length) return out;
  for (const batch of batchBlobRefs(missing)) {
    const paths = batch.map((r) => blobPath(orgId, r));
    try {
      const { data, error } = await client.storage.from(BLOB_BUCKET).createSignedUrls(paths, 3600);
      if (error) continue;
      const map = buildBlobUrlMap(
        data.map((d: { path: string | null; signedUrl: string | null }) => ({ path: d.path ?? "", signedUrl: d.signedUrl })),
        batch,
      );
      Object.assign(out, map);
    } catch {
      // Skip the batch; the renderer leaves the ref visible.
    }
  }
  return out;
}

// The tool output hint used by the side panel's collapsed tool row. Re-exported so the tests
// can hit it without pulling in the side panel.
export const webBoardToolSummary = toolOutputSummary;

// Used in the side panel to know which items carry images. Not part of the public surface but
// re-exported through the module so tests can stub it.
export const _imagePreflight = (items: ThreadItem[]) => {
  const refs = new Set<string>();
  collectBlobRefs(items, refs);
  return refs;
};

// Tag a thread item with its seq so dedupe in applyItemChange can find it. The cloud row's
// seq isn't part of the ThreadItem type (lib/types.ts), so the panel reads it from the
// row directly and writes it on the item here.
export const seqField = "__seq" as const;
export { folderName, BLOB_REF_PREFIX };
