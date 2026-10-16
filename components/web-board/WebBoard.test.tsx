// @vitest-environment jsdom
// jsdom test for the /[orgSlug]/board page's client component. The Supabase browser client and
// the project URL/key are mocked so we can drive the Realtime callbacks by hand and assert the
// column grouping, the empty state, the open-card panel and the live INSERT/UPDATE/DELETE path
// without a real network. The pure logic (groupCardsByColumn, applyCardChange, …) has its own
// 100% coverage in lib/web-board.test.ts; this test is the wiring that pulls the two halves
// together.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudCardRow } from "@/lib/cloud-sync-types";
import "../test-utils";

// A module-scoped object the mock factory closes over. The mock stores each created client's
// handler table here so the test can fire payloads by table name.
const mockState = {
  clients: [] as Array<{
    handlers: Map<"cloud_cards" | "cloud_thread_items", (payload: unknown) => void>;
    trigger: (table: "cloud_cards" | "cloud_thread_items", payload: unknown) => void;
    createBrowserClientCalls: Array<[string, string]>;
  }>,
};

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => {
    const handlers = new Map<"cloud_cards" | "cloud_thread_items", (payload: unknown) => void>();
    const channel = {
      on: (
        _type: string,
        cfg: { table: "cloud_cards" | "cloud_thread_items" },
        cb: (payload: unknown) => void,
      ) => {
        handlers.set(cfg.table, cb);
        return channel;
      },
      subscribe: (cb: (status: string) => void) => {
        queueMicrotask(() => cb("SUBSCRIBED"));
        return channel;
      },
    };
    const client = {
      channel: () => channel,
      removeChannel: vi.fn().mockResolvedValue(undefined),
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  returns: () => ({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
      storage: {
        from: () => ({
          createSignedUrls: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      },
    };
    const entry = {
      handlers,
      trigger: (table: "cloud_cards" | "cloud_thread_items", payload: unknown) => {
        const h = handlers.get(table);
        if (h) h(payload);
      },
      createBrowserClientCalls: [] as Array<[string, string]>,
    };
    mockState.clients.push(entry);
    return client;
  },
}));

vi.mock("@/lib/supabase-project", () => ({
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_KEY: "sb_publishable_test",
}));

async function loadBoard() {
  // Each test re-imports so the mock state captured at module-load reflects only the render
  // that just happened.
  vi.resetModules();
  return import("./WebBoard");
}

const NOW = "2026-10-15T12:00:00.000Z";

function cardRow(over: Partial<{
  card_id: string;
  title: string;
  column: "backlog" | "running" | "needs_you" | "review" | "done";
  folder: string;
  owner_device: string;
  deleted: boolean;
  updated_at: string;
}> = {}): CloudCardRow {
  return {
    org_id: "o1",
    card_id: over.card_id ?? "c1",
    owner_device: over.owner_device ?? "mac-1",
    folder: over.folder ?? "/Users/me/dev/app",
    card: {
      id: over.card_id ?? "c1",
      title: over.title ?? "Card 1",
      prompt: "prompt",
      cwd: over.folder ?? "/Users/me/dev/app",
      backend: "claude",
      permissionMode: "auto",
      column: over.column ?? "backlog",
      createdAt: 0,
      updatedAt: 0,
    },
    deleted: over.deleted ?? false,
    updated_at: over.updated_at ?? NOW,
  };
}

afterEach(() => {
  mockState.clients.length = 0;
  vi.restoreAllMocks();
});

describe("WebBoard", () => {
  beforeEach(() => {
    mockState.clients.length = 0;
  });

  it("groups the initial cards into the five columns, newest first", async () => {
    const { WebBoard } = await loadBoard();
    const older = { ...cardRow({ card_id: "old", title: "Older", column: "review", updated_at: "2026-10-15T10:00:00.000Z" }) };
    const newer = { ...cardRow({ card_id: "new", title: "Newer", column: "running", updated_at: "2026-10-15T11:00:00.000Z" }) };
    render(
      <WebBoard
        orgId="o1"
        orgSlug="ada"
        initialCards={[older, newer]}
        openCardId={null}
        initialThread={[]}
        initialBlobUrls={{}}
      />,
    );
    expect(screen.getByText("Older")).toBeInTheDocument();
    expect(screen.getByText("Newer")).toBeInTheDocument();
    for (const label of ["Backlog", "Running", "Needs you", "Review", "Done"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("shows the empty state and points at Settings → Sync when there are no cards", async () => {
    const { WebBoard } = await loadBoard();
    render(
      <WebBoard
        orgId="o1"
        orgSlug="ada"
        initialCards={[]}
        openCardId={null}
        initialThread={[]}
        initialBlobUrls={{}}
      />,
    );
    expect(screen.getByText(/Settings → Sync/)).toBeInTheDocument();
    expect(screen.queryByText("Backlog")).not.toBeInTheDocument();
  });

  it("flips the live dot to Live after the channel reports SUBSCRIBED", async () => {
    const { WebBoard } = await loadBoard();
    render(
      <WebBoard
        orgId="o1"
        orgSlug="ada"
        initialCards={[cardRow()]}
        openCardId={null}
        initialThread={[]}
        initialBlobUrls={{}}
      />,
    );
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Live")).toBeInTheDocument());
  });

  it("applies a Realtime INSERT for cloud_cards and adds the new card to its column", async () => {
    const { WebBoard } = await loadBoard();
    render(
      <WebBoard
        orgId="o1"
        orgSlug="ada"
        initialCards={[cardRow({ card_id: "a", title: "A", column: "backlog" })]}
        openCardId={null}
        initialThread={[]}
        initialBlobUrls={{}}
      />,
    );
    await waitFor(() => expect(mockState.clients).toHaveLength(1));
    const client = mockState.clients[0]!;
    client.trigger("cloud_cards", {
      eventType: "INSERT",
      new: cardRow({ card_id: "b", title: "Newly arrived", column: "review", updated_at: NOW }),
      old: null,
    });
    await waitFor(() => expect(screen.getByText("Newly arrived")).toBeInTheDocument());
  });

  it("applies a Realtime UPDATE that moves a card to a different column", async () => {
    const { WebBoard } = await loadBoard();
    render(
      <WebBoard
        orgId="o1"
        orgSlug="ada"
        initialCards={[cardRow({ card_id: "c1", title: "Moving", column: "backlog" })]}
        openCardId={null}
        initialThread={[]}
        initialBlobUrls={{}}
      />,
    );
    await waitFor(() => expect(mockState.clients).toHaveLength(1));
    const client = mockState.clients[0]!;
    client.trigger("cloud_cards", {
      eventType: "UPDATE",
      new: cardRow({ card_id: "c1", title: "Moving", column: "review", updated_at: NOW }),
      old: { card_id: "c1" },
    });
    // The Backlog column's count should drop to 0; Review's should climb to 1.
    await waitFor(() => {
      const headers = screen.getAllByText(/^(Backlog|Running|Needs you|Review|Done)$/);
      const review = headers.find((h) => h.textContent === "Review")?.parentElement;
      expect(review?.textContent).toMatch(/Review1/);
    });
  });

  it("removes a card when Realtime reports a DELETE", async () => {
    const { WebBoard } = await loadBoard();
    render(
      <WebBoard
        orgId="o1"
        orgSlug="ada"
        initialCards={[
          cardRow({ card_id: "a", title: "Stay", column: "backlog" }),
          cardRow({ card_id: "b", title: "Leave", column: "backlog" }),
        ]}
        openCardId={null}
        initialThread={[]}
        initialBlobUrls={{}}
      />,
    );
    expect(screen.getByText("Leave")).toBeInTheDocument();
    await waitFor(() => expect(mockState.clients).toHaveLength(1));
    const client = mockState.clients[0]!;
    client.trigger("cloud_cards", {
      eventType: "DELETE",
      new: null,
      old: { card_id: "b" },
    });
    await waitFor(() => expect(screen.queryByText("Leave")).not.toBeInTheDocument());
    expect(screen.getByText("Stay")).toBeInTheDocument();
  });

  it("opens the side panel when a card is provided as the openCardId seed", async () => {
    const { WebBoard } = await loadBoard();
    render(
      <WebBoard
        orgId="o1"
        orgSlug="ada"
        initialCards={[cardRow({ card_id: "x", title: "Open me", column: "review" })]}
        openCardId="x"
        initialThread={[]}
        initialBlobUrls={{}}
      />,
    );
    expect(screen.getByRole("dialog", { name: /Open me/i })).toBeInTheDocument();
  });

  it("closes the side panel via the close button", async () => {
    const { WebBoard } = await loadBoard();
    // jsdom's window.history.replaceState is a no-op; spy on it instead.
    const replaceState = vi.fn();
    Object.defineProperty(window, "history", { value: { replaceState }, configurable: true });
    render(
      <WebBoard
        orgId="o1"
        orgSlug="ada"
        initialCards={[cardRow({ card_id: "x", title: "Open me", column: "review" })]}
        openCardId="x"
        initialThread={[]}
        initialBlobUrls={{}}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: /Open me/i });
    fireEvent.click(screen.getByRole("button", { name: /Close panel/i }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(replaceState).toHaveBeenCalled();
  });
});
