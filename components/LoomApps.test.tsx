// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { MiniApp } from "@/lib/mini-apps";

// My mini apps on the Loom dialog's You tab: lists every saved app with a name, where it lives,
// its share status, and a share button that opens the dialog (stubbed here to a minimal mount).

const useMiniApps = vi.fn<() => MiniApp[]>(() => []);
const ShareAppDialogStub = vi.fn(({ app, onClose }: { app: MiniApp; onClose: () => void }) => (
  <div role="dialog" aria-label={`Share “${app.name}”`}>
    <button onClick={onClose}>Close</button>
  </div>
));
vi.mock("@/lib/use-mini-apps", () => ({ useMiniApps }));
vi.mock("./ShareAppDialog", () => ({ default: ShareAppDialogStub }));

const { default: LoomApps, appWhere } = await import("./LoomApps");

beforeEach(() => {
  useMiniApps.mockReset();
  ShareAppDialogStub.mockClear();
});

describe("LoomApps", () => {
  it("shows the empty state when there are no apps", () => {
    useMiniApps.mockReturnValue([]);
    render(<LoomApps onOpen={vi.fn()} />);
    expect(screen.getByRole("region", { name: "My mini apps" })).toBeInTheDocument();
    expect(screen.getByText(/None yet\. Open a page in the browser pane/)).toBeInTheDocument();
    expect(ShareAppDialogStub).not.toHaveBeenCalled();
  });

  it("lists each app with its name, where, and the shared count when one is shared", () => {
    const apps: MiniApp[] = [
      { id: "a", name: "Docs", url: "https://docs.test/handbook/runbook", addedAt: 1 },
      { id: "b", name: "Local", url: "file:///Users/me/dev/app/index.html", addedAt: 2 },
      { id: "c", name: "Shared", url: "https://shared.test/page", addedAt: 3, share: { id: "s1", mode: "public", hasPassword: false } },
    ];
    useMiniApps.mockReturnValue(apps);
    render(<LoomApps onOpen={vi.fn()} />);
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.getByText("docs.test/handbook/runbook")).toBeInTheDocument();
    expect(screen.getByText("Local")).toBeInTheDocument();
    // index.html keeps its folder name alongside the file name.
    expect(screen.getByText("app/index.html")).toBeInTheDocument();
    expect(screen.getByText("Shared")).toBeInTheDocument();
    // A shared app shows its mode label, not its URL.
    expect(screen.getByText(/🔗 Public/)).toBeInTheDocument();
    // The header carries "3 · 1 shared" as one text node.
    expect(screen.getByText(/3 · 1 shared/)).toBeInTheDocument();
  });

  it("falls back to the raw url for an unparsable app url", () => {
    useMiniApps.mockReturnValue([{ id: "bad", name: "Bad", url: "not a url", addedAt: 1 }]);
    render(<LoomApps onOpen={vi.fn()} />);
    expect(screen.getByText("not a url")).toBeInTheDocument();
  });

  it("opens the app's url when a row is clicked", async () => {
    useMiniApps.mockReturnValue([
      { id: "a", name: "Docs", url: "https://docs.test/handbook", addedAt: 1 },
    ]);
    const onOpen = vi.fn();
    render(<LoomApps onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /^Docs/ }));
    expect(onOpen).toHaveBeenCalledWith("https://docs.test/handbook");
  });

  it("opens the share dialog when the share button is clicked and closes on its Close", async () => {
    useMiniApps.mockReturnValue([
      { id: "a", name: "Docs", url: "https://docs.test/handbook", addedAt: 1 },
    ]);
    render(<LoomApps onOpen={vi.fn()} />);
    expect(ShareAppDialogStub).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Share Docs" }));
    // The stub captured the last render's props.
    const lastCall = ShareAppDialogStub.mock.calls.at(-1);
    expect(lastCall?.[0]).toMatchObject({ app: { id: "a", name: "Docs" } });
    expect(typeof lastCall?.[0]?.onClose).toBe("function");
    const dialog = screen.getByRole("dialog", { name: /Share “Docs”/ });
    expect(dialog).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: /Share “Docs”/ })).not.toBeInTheDocument();
  });
});

describe("appWhere", () => {
  it("returns the host and path for an https url", () => {
    expect(appWhere("https://docs.test/handbook/runbook")).toBe("docs.test/handbook/runbook");
  });
  it("strips a trailing slash from the path", () => {
    expect(appWhere("https://docs.test/handbook/")).toBe("docs.test/handbook");
  });
  it("returns just the file name for a non-index local file", () => {
    expect(appWhere("file:///Users/me/dev/app/login.html")).toBe("login.html");
  });
  it("keeps the folder when the file is index.html", () => {
    expect(appWhere("file:///Users/me/dev/app/index.html")).toBe("app/index.html");
  });
  it("returns the raw url when it cannot be parsed", () => {
    expect(appWhere("not a url")).toBe("not a url");
  });
});
