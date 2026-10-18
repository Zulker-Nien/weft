// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { WelcomeProject } from "@/lib/welcome-preview";

// The first-launch welcome (components/WelcomeDialog.tsx): the board's view of /api/welcome, with
// loadWelcome / answerWelcome faked and answerFor / defaultTicks kept real so the dialog answers
// with the ticks the user actually sees.

const api = vi.hoisted(() => ({
  loadWelcome: vi.fn(),
  answerWelcome: vi.fn(() => Promise.resolve({ welcome: { at: 0, countHistory: true, fresh: false, skip: [] } })),
  changeWelcome: vi.fn(),
}));
vi.mock("@/lib/welcome-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/welcome-client")>("@/lib/welcome-client");
  return { ...actual, loadWelcome: api.loadWelcome, answerWelcome: api.answerWelcome, changeWelcome: api.changeWelcome };
});

const { default: WelcomeDialog } = await import("./WelcomeDialog");

const project = (cwd: string, scratch = false): WelcomeProject => ({
  cwd,
  name: cwd.split("/").pop() || cwd,
  where: cwd,
  sessions: 1,
  last: 1,
  scratch,
});

const preview = (projects: WelcomeProject[], github: unknown = null) => ({
  projects,
  profile: {
    className: "Finisher",
    level: { level: 1, title: "Thread", floor: 0, next: 100 },
    xp: 10,
    sessions: projects.length,
    shipped: 0,
    bestStreak: 0,
    projects: 1,
    top: [],
  },
  github,
});

function setup() {
  api.loadWelcome.mockReset();
  api.answerWelcome.mockReset().mockResolvedValue({ welcome: { at: 0, countHistory: true, fresh: false, skip: [] } });
  api.changeWelcome.mockReset();
}

beforeEach(setup);
afterEach(() => {
  vi.useRealTimers();
});

describe("WelcomeDialog", () => {
  it("renders nothing when the welcome is already answered", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: { at: 1, countHistory: true, fresh: false, skip: [] } });
    const { container } = render(<WelcomeDialog />);
    await waitFor(() => expect(api.loadWelcome).toHaveBeenCalled());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("answers itself with the default welcome when there are no projects", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([]) });
    render(<WelcomeDialog />);
    await waitFor(() => expect(api.answerWelcome).toHaveBeenCalledWith({ countHistory: true, fresh: false, skip: [] }));
  });

  it("opens on screen 1 with the Wefter Profile when projects are available", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    expect(await screen.findByText("Here's your Wefter Profile")).toBeInTheDocument();
    expect(await screen.findByText(/Change it any time in Settings/)).toBeInTheDocument();
  });

  it("screen 1 OK moves to screen 2 with countHistory true", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    await userEvent.click(await screen.findByRole("button", { name: /OK/ }));
    expect(await screen.findByText("Bring in your projects")).toBeInTheDocument();
  });

  it("Opt out on screen 1 moves to screen 2 with countHistory false", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    await userEvent.click(await screen.findByRole("button", { name: "Opt out" }));
    await screen.findByText("Bring in your projects");
    await userEvent.click(screen.getByRole("button", { name: /^OK/ }));
    expect(api.answerWelcome).toHaveBeenLastCalledWith({ countHistory: false, fresh: false, skip: [] });
  });

  it("Start fresh sends fresh true and an empty skip list", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    await userEvent.click(await screen.findByRole("button", { name: /^OK/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Start fresh" }));
    expect(api.answerWelcome).toHaveBeenLastCalledWith({ countHistory: true, fresh: true, skip: [] });
  });

  it("OK on screen 2 with the default ticks sends an empty skip list", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a"), project("/repo/b")]) });
    render(<WelcomeDialog />);
    // Screen 1 → Screen 2.
    await userEvent.click(await screen.findByRole("button", { name: /^OK/ }));
    // Screen 2: OK with both ticked by default.
    await userEvent.click(await screen.findByRole("button", { name: /^OK/ }));
    expect(api.answerWelcome).toHaveBeenLastCalledWith({ countHistory: true, fresh: false, skip: [] });
  });

  it("toggles a project off, then OK sends the unticked folder in skip", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a"), project("/repo/b")]) });
    render(<WelcomeDialog />);
    await userEvent.click(await screen.findByRole("button", { name: /^OK/ }));
    // Now on screen 2; untick /repo/b then click OK to finish.
    await userEvent.click(await screen.findByRole("checkbox", { name: /\/repo\/b/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^OK/ }));
    expect(api.answerWelcome).toHaveBeenLastCalledWith({ countHistory: true, fresh: false, skip: ["/repo/b"] });
  });

  it("scratch projects are unticked and folded under a count", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/real"), project("/tmp/wt", true), project("/tmp/wt2", true)]) });
    render(<WelcomeDialog />);
    await userEvent.click(await screen.findByRole("button", { name: /^OK/ }));
    // The collapse button shows the count and is the only place the scratch names appear.
    const collapse = screen.getByRole("button", { name: /scratch/ });
    expect(collapse).toHaveTextContent("2 scratch, temp and worktree folders left out");
    // Before expanding: one checkbox for the real project.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    await userEvent.click(collapse);
    // After: three checkboxes (real + two scratch).
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("Enter on a checkbox presses OK", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    await userEvent.click(await screen.findByRole("button", { name: /^OK/ }));
    // On screen 2; focus a checkbox and press Enter.
    const checkbox = await screen.findByRole("checkbox");
    checkbox.focus();
    await userEvent.keyboard("{Enter}");
    expect(api.answerWelcome).toHaveBeenCalled();
  });

  it("closes the dialog once the answer is saved", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    const { container } = render(<WelcomeDialog />);
    await userEvent.click(await screen.findByRole("button", { name: /^OK/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^OK/ }));
    await waitFor(() => expect(container.querySelector('[role="dialog"]')).toBeNull());
  });
});
