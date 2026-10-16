// Shared by the weft.zip board's component tests: a stand-in for @supabase/ssr's browser client whose
// Realtime handlers a test fires by hand and whose queries answer from `db`, plus card and thread-row builders.
import { vi } from "vitest";
import type { CloudCardRow, CloudThreadItemRow } from "@/lib/cloud-sync-types";
import type { Card, ThreadItem } from "@/lib/types";

export type Table = "cloud_cards" | "cloud_thread_items";

// What the mocked client answers a query with, by table; a test sets these before it renders.
export const db = {
  items: [] as CloudThreadItemRow[],
  toolOutput: null as string | null,
  signed: {} as Record<string, string>,
};

// A module-scoped object the mock factory closes over: each created client's Realtime handlers, so a
// test can fire payloads by table name.
export const mockState = {
  clients: [] as Array<{ trigger: (table: Table, payload: unknown) => void }>,
  queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
};

// A chainable stand-in for the query builder: every filter returns it, and awaiting it answers.
function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  mockState.queries.push({ table, filters });
  const answer = () => ({ data: table === "cloud_thread_items" ? db.items : [], error: null });
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (k: string, v: unknown) => (filters.push([k, v]), builder),
    lt: (k: string, v: unknown) => (filters.push([`${k}<`, v]), builder),
    order: () => builder,
    limit: () => builder,
    overrideTypes: () => builder,
    maybeSingle: () => Promise.resolve({ data: db.toolOutput === null ? null : { result: db.toolOutput }, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
  };
  return builder;
}

export const supabaseSsrMock = {
  createBrowserClient: () => {
    const handlers = new Map<Table, (payload: unknown) => void>();
    const channel = {
      on: (_type: string, cfg: { table: Table }, cb: (payload: unknown) => void) => {
        handlers.set(cfg.table, cb);
        return channel;
      },
      subscribe: (cb: (status: string) => void) => {
        queueMicrotask(() => cb("SUBSCRIBED"));
        return channel;
      },
    };
    mockState.clients.push({ trigger: (table, payload) => handlers.get(table)?.(payload) });
    return {
      channel: () => channel,
      removeChannel: vi.fn().mockResolvedValue(undefined),
      from: (table: string) => query(table),
      storage: {
        from: () => ({
          createSignedUrls: (paths: string[]) =>
            Promise.resolve({ data: paths.map((path) => ({ path, signedUrl: db.signed[path.split("/").pop() ?? ""] ?? null })), error: null }),
        }),
      },
    };
  },
};

export const supabaseProjectMock = { SUPABASE_URL: "https://test.supabase.co", SUPABASE_KEY: "sb_publishable_test" };


export const NOW = "2026-10-15T12:00:00.000Z";

export function cardRow(over: Partial<{
  card_id: string;
  title: string;
  column: Card["column"];
  folder: string;
  owner_device: string;
  deleted: boolean;
  updated_at: string;
  card: Partial<Card>;
}> = {}): CloudCardRow {
  const folder = over.folder ?? "/Users/me/dev/app";
  const id = over.card_id ?? "c1";
  return {
    org_id: "o1",
    card_id: id,
    owner_device: over.owner_device ?? "mac-1",
    folder,
    card: {
      id,
      title: over.title ?? "Card 1",
      prompt: "prompt",
      cwd: folder,
      backend: "claude",
      permissionMode: "auto",
      column: over.column ?? "backlog",
      createdAt: 0,
      updatedAt: 0,
      ...over.card,
    },
    deleted: over.deleted ?? false,
    updated_at: over.updated_at ?? NOW,
  };
}

export function itemRow(seq: number, item: ThreadItem, card_id = "c1"): CloudThreadItemRow {
  return { org_id: "o1", card_id, seq, kind: item.kind, item, at: NOW };
}


// Back to a clean slate between tests.
export function resetHarness() {
  mockState.clients.length = 0;
  mockState.queries.length = 0;
  db.items = [];
  db.toolOutput = null;
  db.signed = {};
}
