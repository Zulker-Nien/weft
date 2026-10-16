// @vitest-environment jsdom
// The weft.zip board's thread panel, through <WebBoard>: the open card's messages oldest first with tool
// calls folded, paging, live items, signed pictures and trimmed tool results. The Supabase client is the
// harness's (components/web-board/web-board-harness.ts).
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudCardRow, CloudThreadItemRow } from "@/lib/cloud-sync-types";
import "../test-utils";
import { cardRow, db, itemRow, mockState, resetHarness } from "./web-board-harness";

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

describe("WebBoard thread panel", () => {
  const open = (items: CloudThreadItemRow[], over: Partial<CloudCardRow["card"]> = {}) => ({
    ...props,
    openCardId: "c1",
    initialThread: items,
    initialCards: [cardRow({ card_id: "c1", title: "Open me", column: "review", card: over })],
  });

  it("opens the card from the ?card= seed with its thread oldest first, tool calls folded", async () => {
    const { WebBoard } = await loadBoard();
    // Rows come newest first, as the page's query returns them.
    const rows = [
      itemRow(3, { kind: "assistant", text: "All **done**", at: 3 }),
      itemRow(2, { kind: "tool", id: "t1", name: "Bash", summary: "ls", result: "a b", at: 2 }),
      itemRow(1, { kind: "user", text: "please list files", at: 1 }),
    ];
    render(<WebBoard {...open(rows)} />);
    const dialog = screen.getByRole("dialog", { name: /Open me/i });
    const text = dialog.textContent;
    const run = within(dialog).getByRole("button", { expanded: false }).textContent;
    // Oldest first: the question, the folded tool run, then the answer.
    expect(text.indexOf("please list files")).toBeLessThan(text.indexOf(run));
    expect(text.indexOf(run)).toBeLessThan(text.indexOf("All"));
    expect(within(dialog).getByText("done").tagName).toBe("STRONG");
    expect(within(dialog).getByText(/Read-only/)).toBeInTheDocument();
  });

  it("says so when nothing has synced for the open card", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...open([])} />);
    expect(screen.getByText(/Nothing in this thread has synced yet/)).toBeInTheDocument();
  });

  it("opens a card on click: fetches its thread, writes ?card= and shows the messages", async () => {
    const { WebBoard } = await loadBoard();
    const replaceState = vi.spyOn(window.history, "replaceState");
    db.items = [itemRow(1, { kind: "user", text: "hello from the Mac", at: 1 })];
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "c1", title: "Click me", column: "review" })]} />);
    fireEvent.click(screen.getByText("Click me"));
    expect(await screen.findByText("hello from the Mac")).toBeInTheDocument();
    expect(String(replaceState.mock.calls.at(-1)?.[2])).toContain("card=c1");
    const filters = mockState.queries.find((q) => q.table === "cloud_thread_items")?.filters ?? [];
    expect(filters).toContainEqual(["card_id", "c1"]);
  });

  it("an open that finds its thread unreadable shows an empty panel instead of crashing", async () => {
    const { WebBoard } = await loadBoard();
    db.items = [];
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "c1", title: "Click me", column: "review" })]} />);
    fireEvent.click(screen.getByText("Click me"));
    expect(await screen.findByText(/Nothing in this thread has synced yet/)).toBeInTheDocument();
  });

  it("closes on the close button and on Escape, clearing ?card=", async () => {
    const { WebBoard } = await loadBoard();
    const replaceState = vi.spyOn(window.history, "replaceState");
    render(<WebBoard {...open([])} />);
    fireEvent.click(screen.getByRole("button", { name: /Close thread/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(String(replaceState.mock.calls.at(-1)?.[2])).not.toContain("card=");
    fireEvent.click(screen.getByText("Open me"));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes when the backdrop is clicked", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...open([])} />);
    const backdrop = document.querySelector(".absolute.inset-0.z-30") as HTMLElement;
    fireEvent.click(backdrop);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("adds an item that arrives live, and drops one the desktop deleted", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...open([itemRow(1, { kind: "user", text: "first", at: 1 })])} />);
    await waitFor(() => expect(mockState.clients).toHaveLength(1));
    mockState.clients[0]!.trigger("cloud_thread_items", { eventType: "INSERT", new: itemRow(2, { kind: "assistant", text: "arrived live", at: 2 }), old: null });
    expect(await screen.findByText("arrived live")).toBeInTheDocument();
    mockState.clients[0]!.trigger("cloud_thread_items", { eventType: "DELETE", new: null, old: { card_id: "c1", seq: 2 } });
    await waitFor(() => expect(screen.queryByText("arrived live")).not.toBeInTheDocument());
  });

  it("pages back with Load earlier messages from the oldest seq it holds", async () => {
    const { WebBoard } = await loadBoard();
    const page = Array.from({ length: 50 }, (_, i) => itemRow(100 - i, { kind: "assistant", text: `msg ${100 - i}`, at: 100 - i }));
    db.items = [itemRow(50, { kind: "assistant", text: "an older message", at: 1 })];
    render(<WebBoard {...open(page)} />);
    fireEvent.click(screen.getByRole("button", { name: /Load earlier messages/ }));
    expect(await screen.findByText("an older message")).toBeInTheDocument();
    const older = mockState.queries.filter((q) => q.table === "cloud_thread_items").at(-1)?.filters ?? [];
    expect(older).toContainEqual(["seq<", 51]);
    // The older page was short, so there is nothing further back.
    expect(screen.queryByRole("button", { name: /Load earlier messages/ })).not.toBeInTheDocument();
  });

  it("shows a screenshot a tool took through its signed URL", async () => {
    const { WebBoard } = await loadBoard();
    const sha = "b".repeat(64);
    db.signed[sha] = `https://test.supabase.co/storage/v1/object/sign/weft-blobs/o1/${sha}?token=t`;
    const rows = [itemRow(1, { kind: "tool", id: "t1", name: "mcp__browser__screenshot", summary: "shot", result: "ok", images: [`blob:sha256:${sha}`], at: 1 })];
    render(<WebBoard {...open(rows)} />);
    await waitFor(() => expect(document.querySelector("img[src*='/object/sign/weft-blobs/']")).not.toBeNull());
  });

  it("fetches a trimmed tool result from cloud_tool_outputs when its row opens", async () => {
    const { WebBoard } = await loadBoard();
    db.toolOutput = "the full output";
    const rows = [itemRow(1, { kind: "tool", id: "t9", name: "Bash", summary: "big", resultBytes: 9000, at: 1 })];
    render(<WebBoard {...open(rows)} />);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { expanded: false }));
    const details = document.querySelector("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findByText("the full output")).toBeInTheDocument();
    const q = mockState.queries.find((x) => x.table === "cloud_tool_outputs");
    expect(q?.filters).toContainEqual(["tool_id", "t9"]);
  });

  it("says so when a trimmed tool result can't be read", async () => {
    const { WebBoard } = await loadBoard();
    db.toolOutput = null;
    const rows = [itemRow(1, { kind: "tool", id: "t9", name: "Bash", summary: "big", resultBytes: 9000, at: 1 })];
    render(<WebBoard {...open(rows)} />);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { expanded: false }));
    const details = document.querySelector("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findByText(/Couldn't load the result/)).toBeInTheDocument();
  });
});
