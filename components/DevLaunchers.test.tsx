// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DevLauncher } from "@/lib/types";

const { default: DevLaunchers } = await import("./DevLaunchers");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// A folder with a single stop command, so the row shows Start and the command in a span.
const stopped = (over: Partial<DevLauncher> = {}): DevLauncher => ({
  cwd: "/dev/deckcp",
  commands: [{ command: "pnpm dev", label: "dev" }],
  ...over,
});

// A folder with a single live run, so the row shows Restart, the status line and the url button.
const live = (over: Partial<DevLauncher> = {}): DevLauncher => ({
  cwd: "/dev/deckcp",
  commands: [{
    command: "pnpm dev",
    label: "dev",
    url: "http://localhost:4001",
    run: { id: "dev:folder:/dev/deckcp", state: "running", startedAt: 0, restarts: 0 },
  }],
  ...over,
});

const props = (over: Partial<Parameters<typeof DevLaunchers>[0]> = {}) => ({
  launchers: [stopped()],
  launch: vi.fn(() => Promise.resolve("started" as const)),
  onOpenUrl: vi.fn(),
  notify: vi.fn(),
  ...over,
});

describe("DevLaunchers", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<DevLaunchers {...props({ launchers: [] })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the folder, command and Start, and the click calls launch and flashes Started", async () => {
    const p = props({
      launchers: [stopped({ cwd: "/dev/deckcp", commands: [{ command: "pnpm dev", label: "dev script" }] })],
      launch: vi.fn(() => Promise.resolve("started" as const)),
    });
    render(<DevLaunchers {...p} />);
    expect(screen.getByText("deckcp")).toBeTruthy();
    expect(screen.getByText("pnpm dev")).toBeTruthy();
    expect(screen.getByTitle("pnpm dev (dev script)")).toBeTruthy();
    const start = screen.getByRole("button", { name: "Start" });
    await userEvent.click(start);
    expect(p.launch).toHaveBeenCalledWith("/dev/deckcp", "pnpm dev");
    expect(await screen.findByRole("status")).toHaveTextContent("Started");
  });

  it("flashes Restarted when the launch resolves to 'restarted'", async () => {
    const p = props({ launch: vi.fn(() => Promise.resolve("restarted" as const)) });
    render(<DevLaunchers {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Restarted");
  });

  it("a live run shows Restart, the status line, and the url button calls onOpenUrl", async () => {
    const p = props({ launchers: [live()] });
    render(<DevLaunchers {...p} />);
    const restart = screen.getByRole("button", { name: "Restart" });
    expect(restart).toBeTruthy();
    // The status line shows the verb ("Started HH:MM · running") — the clock depends on the test locale,
    // so we only assert the verb and the live-state suffix.
    expect(screen.getByText(/Started \d\d:\d\d · running/)).toBeTruthy();
    // The url button shows ":4001" (the host is stripped); that's its accessible text in jsdom.
    const url = screen.getByRole("button", { name: ":4001" });
    expect(url).toHaveTextContent(":4001");
    await userEvent.click(url);
    expect(p.onOpenUrl).toHaveBeenCalledWith("http://localhost:4001");
    // Clicking Restart still routes through launch with the right cwd and command.
    await userEvent.click(restart);
    expect(p.launch).toHaveBeenCalledWith("/dev/deckcp", "pnpm dev");
  });

  it("a live run's Stop calls stop with its id and flashes Stopped; no stop prop, no Stop", async () => {
    const stop = vi.fn(() => Promise.resolve());
    const { rerender } = render(<DevLaunchers {...props({ launchers: [live()], stop })} />);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stop).toHaveBeenCalledWith("dev:folder:/dev/deckcp");
    expect(await screen.findByRole("status")).toHaveTextContent("Stopped");
    rerender(<DevLaunchers {...props({ launchers: [live()] })} />);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("a stopped folder has no Stop", () => {
    render(<DevLaunchers {...props({ stop: vi.fn(() => Promise.resolve()) })} />);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("names the card that started a run, and the name opens it", async () => {
    const onOpenCard = vi.fn();
    const owned = live({ commands: [{ command: "pnpm dev", label: "dev", run: { id: "dev:c1", state: "running", startedAt: 0, restarts: 0, cardId: "c1", title: "Fix login" } }] });
    render(<DevLaunchers {...props({ launchers: [owned], onOpenCard })} />);
    await userEvent.click(screen.getByRole("button", { name: "Fix login" }));
    expect(onOpenCard).toHaveBeenCalledWith("c1");
  });

  it("lists Weft's own folder as the board itself, with no Start or Stop", () => {
    render(<DevLaunchers {...props({ launchers: [stopped({ cwd: "/dev/weft", self: true })], stop: vi.fn(() => Promise.resolve()) })} />);
    expect(screen.getByText("weft")).toBeTruthy();
    expect(screen.getByText("Weft itself: this board runs from here")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("links Weft's own address, opening it in the system browser rather than the pane", async () => {
    const openExternal = vi.fn();
    vi.stubGlobal("threadboard", { openExternal });
    const p = props({ launchers: [stopped({ cwd: "/dev/weft", self: true, url: "http://127.0.0.1:1024" })] });
    render(<DevLaunchers {...p} />);
    await userEvent.click(screen.getByRole("button", { name: ":1024 ↗" }));
    expect(openExternal).toHaveBeenCalledWith("http://127.0.0.1:1024");
    expect(p.onOpenUrl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await userEvent.click(screen.getByRole("button", { name: ":1024 ↗" }));
    expect(open).toHaveBeenCalledWith("http://127.0.0.1:1024", "_blank", "noopener");
  });

  it("a folder with two commands shows a select, and picking the second switches the row", async () => {
    const launcher: DevLauncher = {
      cwd: "/dev/deckcp",
      commands: [
        { command: "pnpm dev", label: "dev" },
        { command: "pnpm start", label: "start" },
      ],
    };
    const p = props({ launchers: [launcher] });
    render(<DevLaunchers {...p} />);
    const select = screen.getByLabelText<HTMLSelectElement>("Dev command for deckcp");
    expect(select).toBeInTheDocument();
    expect(select.value).toBe("pnpm dev");
    await userEvent.selectOptions(select, "pnpm start");
    expect(select.value).toBe("pnpm start");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(p.launch).toHaveBeenCalledWith("/dev/deckcp", "pnpm start");
  });

  it("calls notify when launch rejects", async () => {
    const err = new Error("denied");
    const p = props({ launch: vi.fn(() => Promise.reject(err)) });
    render(<DevLaunchers {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(p.notify).toHaveBeenCalledWith(err));
    // The button is no longer busy.
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Start" }).disabled).toBe(false);
  });

  it("the Started chip disappears after 4 s (fake timers)", async () => {
    vi.useFakeTimers();
    // A deferred promise so the click can set the flash, then the resolve lets the .then run.
    let resolveLaunch!: (value: "started" | "restarted") => void;
    const p = props({
      launch: vi.fn(() => new Promise<"started" | "restarted">((res) => { resolveLaunch = res; })),
    });
    render(<DevLaunchers {...p} />);
    // Click via the DOM so the test isn't held up by userEvent's microtask scheduling under fake timers.
    act(() => {
      screen.getByRole("button", { name: "Start" }).click();
    });
    // While the promise is pending, no chip is shown yet.
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => {
      resolveLaunch("started");
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Started");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
