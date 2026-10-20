// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerFatal } from "@/lib/server-status";
import ServerErrorBar from "./ServerErrorBar";

// The bar subscribes to window.weft.server.onFatal in a useEffect and reads window.weft.server.retry
// etc. on click. We stub the bridge with a small mock that the tests can drive: each test sets the
// module-level `fatal` before render (the mock below reads it directly), and `pushFatal` updates the
// same variable so the bar re-renders. This mirrors components/BuildErrorBar.test.tsx exactly.

let fatal: ServerFatal | null = null;
let statusText: string | null = null;
const retry = vi.fn(() => Promise.resolve({ ok: true }));
const openLogs = vi.fn(async () => {});
const createFixCard = vi.fn(async () => {});

vi.mock("@/lib/server-status", () => ({
  useServerFatal: () => fatal,
  useServerStatus: () => statusText,
}));

// The bar reads window.weft inside click handlers; the bridge mocks don't need to do anything here
// because the click handlers call the mocks directly. We still install a stub for symmetry.
function installBridge() {
  (globalThis as unknown as { weft: unknown }).weft = {
    server: {
      retry,
      openLogs,
      createFixCard,
      logTail: vi.fn(() => Promise.resolve("tail")),
      onFatal: () => () => {},
      onStatus: () => () => {},
    },
  };
}

afterEach(() => {
  cleanup();
  fatal = null;
  statusText = null;
  retry.mockClear();
  openLogs.mockClear();
  createFixCard.mockClear();
});

describe("ServerErrorBar", () => {
  it("draws nothing with no fatal", () => {
    installBridge();
    fatal = null;
    render(<ServerErrorBar />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the fatal message and the three buttons", () => {
    installBridge();
    fatal = { message: "The server stopped 4 times in two minutes." };
    render(<ServerErrorBar />);
    expect(screen.getByRole("alert").textContent).toContain("The server stopped 4 times in two minutes.");
    expect(screen.getByText("Restart server")).toBeTruthy();
    expect(screen.getByText("Open logs")).toBeTruthy();
    expect(screen.getByText("Fix with a thread")).toBeTruthy();
  });

  it("shows the live status text alongside the fatal when one is set", () => {
    installBridge();
    fatal = { message: "The server stopped 4 times in two minutes." };
    statusText = "Restarting…";
    render(<ServerErrorBar />);
    expect(screen.getByRole("alert").textContent).toContain("Restarting…");
  });

  it("Restart server calls window.weft.server.retry and dismisses on success", async () => {
    installBridge();
    fatal = { message: "Server down." };
    const user = userEvent.setup();
    render(<ServerErrorBar />);
    await user.click(screen.getByText("Restart server"));
    await waitFor(() => expect(retry).toHaveBeenCalled());
    // After successful retry, the bar should dismiss itself.
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("Open logs calls window.weft.server.openLogs", async () => {
    installBridge();
    fatal = { message: "Server down." };
    const user = userEvent.setup();
    render(<ServerErrorBar />);
    await user.click(screen.getByText("Open logs"));
    expect(openLogs).toHaveBeenCalled();
  });

  it("Fix with a thread calls window.weft.server.createFixCard and dismisses", async () => {
    installBridge();
    fatal = { message: "Server down." };
    const user = userEvent.setup();
    render(<ServerErrorBar />);
    await user.click(screen.getByText("Fix with a thread"));
    await waitFor(() => expect(createFixCard).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("dismisses until a different error shows", async () => {
    installBridge();
    fatal = { message: "first" };
    const user = userEvent.setup();
    const { rerender } = render(<ServerErrorBar />);
    await user.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByRole("alert")).toBeNull();
    // Same fatal re-pushed: bar stays hidden.
    rerender(<ServerErrorBar />);
    expect(screen.queryByRole("alert")).toBeNull();
    // Different fatal: bar shows again.
    fatal = { message: "second" };
    rerender(<ServerErrorBar />);
    expect(screen.getByRole("alert").textContent).toContain("second");
  });
});
