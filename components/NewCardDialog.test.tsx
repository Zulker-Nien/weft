// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewCardInput } from "@/lib/client";
import type { Card } from "@/lib/types";
import { makeCard } from "./test-utils";
import NewCardDialog from "./NewCardDialog";

const api = vi.hoisted(() => ({
  settings: vi.fn(() => Promise.resolve({ defaultPermissionMode: "default", defaultBackend: "claude" })),
  warm: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/client", () => ({ api }));
vi.mock("./Composer", () => import("./composer-mock"));
// The real picker lists repos from the server and GitHub; this one just shows the folder and offers another.
vi.mock("./RepoPicker", () => ({
  default: ({ value, onChange }: { value: string; onChange: (folder: string) => void }) => (
    <div>
      <span>Folder: {value}</span>
      <button type="button" onClick={() => onChange("/repo/api")}>
        Pick /repo/api
      </button>
    </div>
  ),
}));

function setup(props: { cards?: Card[]; defaultCwd?: string } = {}) {
  const onCreate = vi.fn<(input: NewCardInput) => Promise<void>>(() => Promise.resolve());
  const onClose = vi.fn();
  render(<NewCardDialog home="/home" defaultCwd="/repo/web" onCreate={onCreate} onClose={onClose} {...props} />);
  return { onCreate, onClose, box: screen.getByRole("textbox", { name: "Message" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("NewCardDialog", () => {
  it("needs a prompt before it starts", async () => {
    const { onCreate } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Start now" }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText("Write a prompt first.")).toBeInTheDocument();
  });

  it("Start now creates a started card in the chosen folder and closes", async () => {
    const { onCreate, onClose, box } = setup();
    await userEvent.type(box, "Add dark mode");
    await userEvent.click(screen.getByRole("button", { name: "Start now" }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Add dark mode", cwd: "/repo/web", backend: "claude", start: true }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("Add to backlog creates the card without starting it", async () => {
    const { onCreate, box } = setup();
    await userEvent.type(box, "Later idea");
    await userEvent.click(screen.getByRole("button", { name: "Add to backlog" }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Later idea", cwd: "/repo/web", start: false }));
  });

  it("picking another folder uses it, warms a CLI there and remembers it", async () => {
    const { onCreate, box } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Pick /repo/api" }));
    expect(screen.getByText("Folder: /repo/api")).toBeInTheDocument();
    expect(api.warm).toHaveBeenCalledWith({ cwd: "/repo/api", backend: "claude" });
    await userEvent.type(box, "Fix the API");
    await userEvent.click(screen.getByRole("button", { name: "Start now" }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo/api" }));
    await waitFor(() => expect(localStorage.getItem("threadboard.cwd")).toBe("/repo/api"));
  });

  // The dialog normalizes the picked effort through effortFor: puku drops xhigh, keeps low/medium/high/max.
// (effortFor is unit-tested in lib/new-thread.test.ts; this just pins the wiring through the dialog.)
  it("the CLI toggle passes the picked effort through effortFor, so puku keeps high", async () => {
    const { onCreate, box } = setup();
    await userEvent.click(screen.getByRole("button", { name: "puku-cli" }));
    await userEvent.type(box, "Hi");
    await userEvent.click(screen.getByRole("button", { name: "Start now" }));
    // The dialog's default effort is "high" (lastEffort), which puku accepts.
    expect(onCreate).toHaveBeenLastCalledWith(expect.objectContaining({ backend: "puku", effort: "high" }));
  });

  it("starts in Settings' default permission mode", async () => {
    const { onCreate, box } = setup();
    await waitFor(() => expect(api.settings).toHaveBeenCalled());
    await userEvent.type(box, "Hi");
    await userEvent.click(screen.getByRole("button", { name: "Start now" }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: "default" }));
  });

  it("shows a failed create and stays open", async () => {
    const { onCreate, onClose, box } = setup();
    onCreate.mockRejectedValueOnce(new Error("Folder not found"));
    await userEvent.type(box, "Hi");
    await userEvent.click(screen.getByRole("button", { name: "Start now" }));
    expect(await screen.findByText("Folder not found")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("⌃↵ starts the thread and stays open, emptied, for the next one", async () => {
    const { onCreate, onClose, box } = setup();
    await userEvent.type(box, "First task");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "First task", start: true }), { stay: true });
    expect(await screen.findByText("Started “First task” · write the next one")).toBeInTheDocument();
    expect(box).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.type(box, "S");
    expect(screen.queryByText(/Started “/)).not.toBeInTheDocument();
  });

  it("a started thread clears the draft", async () => {
    const { box } = setup();
    await userEvent.type(box, "Ship it");
    await waitFor(() => expect(localStorage.getItem("weft.newThreadDraft")).toBe("Ship it"));
    await userEvent.click(screen.getByRole("button", { name: "Start now" }));
    await waitFor(() => expect(localStorage.getItem("weft.newThreadDraft")).toBeNull());
  });

  it("⌃↵ starts the thread and stays open, emptied, for the next one", async () => {
    const { onCreate, onClose, box } = setup();
    await userEvent.type(box, "First task");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "First task", start: true }), { stay: true });
    expect(await screen.findByText("Started “First task” · write the next one")).toBeInTheDocument();
    expect(box).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.type(box, "S");
    expect(screen.queryByText(/Started “/)).not.toBeInTheDocument();
  });

  it("the Start button names what ⌘↵ and ⌃↵ do while they're held", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" });
    setup();
    const key = (init: KeyboardEventInit) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", init)));
    key({ key: "Meta", metaKey: true });
    expect(screen.getByRole("button", { name: "Start & close" })).toBeInTheDocument();
    key({ key: "Control", ctrlKey: true });
    expect(screen.getByRole("button", { name: "Start, keep open" })).toBeInTheDocument();
    act(() => void window.dispatchEvent(new Event("blur")));
    expect(screen.getByRole("button", { name: "Start now" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("keeps the prompt as a draft for next time", async () => {
    const { box } = setup();
    await userEvent.type(box, "Unfinished");
    await waitFor(() => expect(localStorage.getItem("weft.newThreadDraft")).toBe("Unfinished"));
  });

  it("closes on Escape and on the close button", async () => {
    const { onClose } = setup();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  describe("busy-folder hint", () => {
    const busy = makeCard({ id: "c2", title: "Refactor auth", cwd: "/repo/web", column: "running" });

    it("warns when a card is busy in the chosen folder", () => {
      setup({ cards: [busy] });
      expect(screen.getByText("Also running here: Refactor auth")).toBeInTheDocument();
    });

    it("doesn't warn for idle cards or other folders, and follows the folder you pick", async () => {
      setup({ cards: [makeCard({ id: "c3", cwd: "/repo/web", column: "review" }), { ...busy, cwd: "/repo/api" }] });
      expect(screen.queryByText(/Also running here/)).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Pick /repo/api" }));
      expect(screen.getByText("Also running here: Refactor auth")).toBeInTheDocument();
    });
  });
});
