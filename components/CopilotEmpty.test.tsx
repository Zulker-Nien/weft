// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CopilotEmpty from "./CopilotEmpty";
import "./test-utils";

const api = vi.hoisted(() => ({ copilotSuggestions: vi.fn(), copilotChipClicked: vi.fn(() => Promise.resolve({ ok: true })) }));
vi.mock("@/lib/client", () => ({ api }));

afterEach(cleanup);

describe("CopilotEmpty", () => {
  it("shows the board's chips above the starters, hides covered starters, and sends and logs a click", async () => {
    api.copilotSuggestions.mockResolvedValue({
      chips: [{ text: "Commit +4234/-1115 in weft", cardId: "a" }],
      covers: ["Let's commit all the new stuff"],
    });
    const onAsk = vi.fn();
    render(<CopilotEmpty onAsk={onAsk} />);
    expect(screen.getByText("Reading your board…")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Commit +4234/-1115 in weft" }));
    expect(screen.getByText("From your board")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Let's commit all the new stuff" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Help me get started with Weft" }));
    expect(onAsk.mock.calls).toEqual([["Commit +4234/-1115 in weft"], ["Help me get started with Weft"]]);
    expect(api.copilotChipClicked).toHaveBeenCalledWith("Commit +4234/-1115 in weft");
    expect(screen.getAllByRole("button")).toHaveLength(7);
  });

  it("shows all seven starters when the board has nothing to suggest or the call fails", async () => {
    api.copilotSuggestions.mockRejectedValue(new Error("down"));
    api.copilotChipClicked.mockRejectedValueOnce(new Error("down"));
    const onAsk = vi.fn();
    render(<CopilotEmpty onAsk={onAsk} />);
    await vi.waitFor(() => expect(screen.queryByText("Reading your board…")).not.toBeInTheDocument());
    expect(screen.queryByText("From your board")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(7);
    await userEvent.click(screen.getByRole("button", { name: "Let's commit all the new stuff" }));
    expect(onAsk).toHaveBeenCalledWith("Let's commit all the new stuff");
  });

  it("shows only the selected project's chips and account-wide ones, and only their covers hide starters", async () => {
    api.copilotSuggestions.mockResolvedValue({
      chips: [
        { text: "Commit weft", project: "/dev/weft", covers: ["Let's commit all the new stuff"] },
        { text: "Fix the groovenfill deploy", project: "/dev/groovenfill", covers: ["How can I improve my codebase?"] },
        { text: "Sign in to Weft" },
      ],
      covers: ["Let's commit all the new stuff", "How can I improve my codebase?"],
    });
    render(<CopilotEmpty project="/dev/groovenfill" onAsk={() => {}} />);
    expect(await screen.findByRole("button", { name: "Fix the groovenfill deploy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in to Weft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Commit weft" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Let's commit all the new stuff" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "How can I improve my codebase?" })).not.toBeInTheDocument();
  });

  it("reads the saved project from the view cookie when the board doesn't pass one", async () => {
    document.cookie = `weft-view=${encodeURIComponent(JSON.stringify({ project: "/dev/weft", sort: "newest" }))}; path=/`;
    api.copilotSuggestions.mockResolvedValue({ chips: [{ text: "Commit weft", project: "/dev/weft" }, { text: "Fix groovenfill", project: "/dev/groovenfill" }], covers: [] });
    render(<CopilotEmpty onAsk={() => {}} />);
    expect(await screen.findByRole("button", { name: "Commit weft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fix groovenfill" })).not.toBeInTheDocument();
    document.cookie = "weft-view=; path=/; max-age=0";
  });

  it("ignores covers when there are no board chips", async () => {
    api.copilotSuggestions.mockResolvedValue({ chips: [], covers: ["Let's commit all the new stuff"] });
    render(<CopilotEmpty onAsk={() => {}} />);
    await vi.waitFor(() => expect(screen.queryByText("Reading your board…")).not.toBeInTheDocument());
    expect(screen.getAllByRole("button")).toHaveLength(7);
  });
});
