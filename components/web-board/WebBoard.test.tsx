// @vitest-environment jsdom
// jsdom test for the /[orgSlug]/board page's client component. The Supabase browser client and
// the project URL/key are mocked so we can drive the Realtime callbacks by hand and assert what the
// board draws: the desktop's columns and cards read-only, the project bar's filters, the thread
// panel and the live INSERT/UPDATE/DELETE path, without a real network. The pure logic
// (webCards, applyCardChange, …) has its own coverage in lib/web-board.test.ts; this is the wiring.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudThreadItemRow } from "@/lib/cloud-sync-types";
import "../test-utils";
import { cardRow, mockState, resetHarness } from "./web-board-harness";

vi.mock("@supabase/ssr", async () => (await import("./web-board-harness")).supabaseSsrMock);
vi.mock("@/lib/supabase-project", async () => (await import("./web-board-harness")).supabaseProjectMock);

async function loadBoard() {
  return import("./WebBoard");
}

const props = { orgId: "o1", orgSlug: "ada", openCardId: null, initialThread: [] as CloudThreadItemRow[], initialBlobUrls: {} };

afterEach(() => {
  resetHarness();
  vi.restoreAllMocks();
});

const column = (id: string) => within(document.querySelector(`[data-column="${id}"]`) as HTMLElement);

describe("WebBoard", () => {
  it("draws the desktop's five columns with their cards and counts", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "old", title: "Older", column: "review" }), cardRow({ card_id: "new", title: "Newer", column: "running" })]} />);
    for (const label of ["Backlog", "Running", "Needs you", "Review", "Done"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(column("review").getByText("Older")).toBeInTheDocument();
    expect(column("running").getByText("Newer")).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByText(/1 running/)).toBeInTheDocument();
  });

  it("shows what a card's thread said, its stage and its tags, as the desktop card does", async () => {
    const { WebBoard } = await loadBoard();
    const row = cardRow({ card_id: "x", title: "Rich", column: "review", card: { lastLine: "Added the tests", stage: "Polishing", remaining: "docs", tags: ["web"] } });
    render(<WebBoard {...props} initialCards={[row]} />);
    expect(screen.getByText("Added the tests")).toBeInTheDocument();
    expect(screen.getByText("Polishing")).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();
  });

  it("counts cards that need you in the header and lights the column", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "n", title: "Asks", column: "needs_you" })]} />);
    expect(within(screen.getByRole("banner")).getByText(/1 needs you/)).toBeInTheDocument();
  });

  it("offers no way to act on a card: no stop, star, archive or drag", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "r", title: "Busy", column: "running" }), cardRow({ card_id: "d", title: "Finished", column: "done" })]} />);
    expect(screen.queryByLabelText("Stop this thread")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/star/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/archive/i)).not.toBeInTheDocument();
    expect(document.querySelector("[draggable=true]")).toBeNull();
  });

  it("shows the empty state and points at Settings → Sync when there are no cards", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[]} />);
    expect(screen.getByText(/Settings → Sync/)).toBeInTheDocument();
    expect(screen.queryByText("Backlog")).not.toBeInTheDocument();
  });

  it("flips the live dot to Live after the channel reports SUBSCRIBED", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow()]} />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Live")).toBeInTheDocument());
  });

  it("filters by project chip and by the filter box, and sorts", async () => {
    const { WebBoard } = await loadBoard();
    render(
      <WebBoard
        {...props}
        initialCards={[
          cardRow({ card_id: "a", title: "In app", folder: "/Users/me/dev/app" }),
          cardRow({ card_id: "b", title: "In site", folder: "/Users/me/dev/site", card: { lastLine: "wrote the footer" } }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /^site/ }));
    expect(screen.queryByText("In app")).not.toBeInTheDocument();
    expect(screen.getByText("In site")).toBeInTheDocument();
    // Clicking the chosen chip again clears it.
    fireEvent.click(screen.getByRole("button", { name: /^site/ }));
    expect(screen.getByText("In app")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter cards"), { target: { value: "footer" } });
    expect(screen.queryByText("In app")).not.toBeInTheDocument();
    expect(screen.getByText("In site")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter cards"), { target: { value: "zzz" } });
    expect(screen.getAllByText("No matching cards").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Sort cards"), { target: { value: "oldest" } });
    expect(screen.getByLabelText("Sort cards")).toHaveValue("oldest");
  });

  it("hides archived cards until the Done column's toggle shows them", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "z", title: "Filed away", column: "done", card: { archived: true } })]} />);
    expect(screen.queryByText("Filed away")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Show 1 archived/ }));
    expect(screen.getByText("Filed away")).toBeInTheDocument();
  });

  it("folds a long column behind Show N more", async () => {
    const { WebBoard } = await loadBoard();
    const rows = Array.from({ length: 42 }, (_, i) => cardRow({ card_id: `k${i}`, title: `Card ${i}`, column: "backlog" }));
    render(<WebBoard {...props} initialCards={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(screen.queryByRole("button", { name: /Show \d+ more/ })).not.toBeInTheDocument();
  });

  it("applies a Realtime INSERT for cloud_cards and adds the new card to its column", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "a", title: "A", column: "backlog" })]} />);
    await waitFor(() => expect(mockState.clients).toHaveLength(1));
    mockState.clients[0]!.trigger("cloud_cards", { eventType: "INSERT", new: cardRow({ card_id: "b", title: "Newly arrived", column: "review" }), old: null });
    await waitFor(() => expect(column("review").getByText("Newly arrived")).toBeInTheDocument());
  });

  it("applies a Realtime UPDATE that moves a card to a different column", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "c1", title: "Moving", column: "backlog" })]} />);
    await waitFor(() => expect(mockState.clients).toHaveLength(1));
    mockState.clients[0]!.trigger("cloud_cards", { eventType: "UPDATE", new: cardRow({ card_id: "c1", title: "Moving", column: "review" }), old: { card_id: "c1" } });
    await waitFor(() => expect(column("review").getByText("Moving")).toBeInTheDocument());
    expect(column("backlog").queryByText("Moving")).not.toBeInTheDocument();
  });

  it("removes a card when Realtime reports a DELETE", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "a", title: "Stay" }), cardRow({ card_id: "b", title: "Leave" })]} />);
    await waitFor(() => expect(mockState.clients).toHaveLength(1));
    mockState.clients[0]!.trigger("cloud_cards", { eventType: "DELETE", new: null, old: { card_id: "b" } });
    await waitFor(() => expect(screen.queryByText("Leave")).not.toBeInTheDocument());
    expect(screen.getByText("Stay")).toBeInTheDocument();
  });

  it("ignores a Realtime payload with neither a new nor an old row", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ title: "Still here" })]} />);
    await waitFor(() => expect(mockState.clients).toHaveLength(1));
    mockState.clients[0]!.trigger("cloud_cards", { eventType: "UPDATE", new: null, old: null });
    expect(screen.getByText("Still here")).toBeInTheDocument();
  });
});

