// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { VaultBridge, VaultSecret, VaultSummary } from "./vault-view";
import { useVaultActions } from "./use-vault-actions";

const secret: VaultSecret = { name: "API_KEY", environment: "development", missing: false, tail: "1111", updatedAt: "" };

// vitest 4 narrows `vi.fn()` to `Mock<Procedure | Constructable>`, which no longer matches a typed
// bridge member like `(folders: string[]) => Promise<VaultOverview>`. The runtime mock is fine;
// a permissive `Mock<any[], any>` is what the tests need — each test only asserts on the return
// value, the call arguments, or the spy side-effects. Lint would flag the looser shape, so the
// alias silences the rule (the type alias is the one place we mean it).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockFn = Mock<(...args: any[]) => any>;
function bridge(over: Partial<VaultBridge> = {}): { [K in keyof Required<VaultBridge>]: MockFn } {
  const b: { [K in keyof Required<VaultBridge>]: MockFn } = {
    overview: vi.fn(),
    scan: vi.fn(),
    import: vi.fn(),
    reveal: vi.fn(),
    copy: vi.fn(),
    set: vi.fn(),
    addBlank: vi.fn(),
    copyTo: vi.fn(),
    remove: vi.fn(),
    lock: vi.fn(),
    ...(over as { [K in keyof Required<VaultBridge>]?: MockFn }),
  } as { [K in keyof Required<VaultBridge>]: MockFn };
  b.import.mockResolvedValue({ imported: 1 });
  b.reveal.mockResolvedValue({ value: "sk-live-1111" });
  b.copy.mockResolvedValue({ copied: true });
  b.set.mockResolvedValue({ saved: true });
  b.addBlank.mockResolvedValue({ label: "notes", filled: [] });
  b.copyTo.mockResolvedValue({ copied: true, label: "notes", replaced: false });
  b.remove.mockResolvedValue({ removed: true });
  b.lock.mockResolvedValue({ unlocked: false });
  return b;
}

function vault(over: Partial<VaultSummary> = {}): VaultSummary {
  return { id: "github:o/web", label: "o/web", folder: "/dev/web", folders: ["/dev/web"], secrets: [secret], nudge: null, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("useVaultActions", () => {
  it("reveal: stores the value and marks the vault unlocked", async () => {
    const b = bridge();
    const reload = vi.fn();
    const notify = vi.fn();
    const { result } = renderHook(() => useVaultActions(b, { vaults: [vault()] }, reload, notify));
    await act(async () => { await result.current.act(vault(), secret, "reveal"); });
    expect(b.reveal).toHaveBeenCalledWith("github:o/web", "API_KEY", "development");
    expect(result.current.revealed.get("github:o/web\ndevelopment\nAPI_KEY")).toBe("sk-live-1111");
    expect(result.current.unlocked).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reveal (again): toggles the revealed value off", async () => {
    const b = bridge();
    const { result } = renderHook(() => useVaultActions(b, { vaults: [vault()] }, vi.fn(), vi.fn()));
    await act(async () => { await result.current.act(vault(), secret, "reveal"); });
    await act(async () => { await result.current.act(vault(), secret, "reveal"); });
    expect(result.current.revealed.size).toBe(0);
  });

  it("copy: marks unlocked, no reload", async () => {
    const b = bridge();
    const reload = vi.fn();
    const notify = vi.fn();
    const { result } = renderHook(() => useVaultActions(b, { vaults: [vault()] }, reload, notify));
    await act(async () => { await result.current.act(vault(), secret, "copy"); });
    expect(b.copy).toHaveBeenCalledWith("github:o/web", "API_KEY", "development");
    expect(result.current.unlocked).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it("copy: ignores the denied Touch ID outcome", async () => {
    const b = bridge();
    b.copy.mockResolvedValue({ denied: true });
    const { result } = renderHook(() => useVaultActions(b, { vaults: [vault()] }, vi.fn(), vi.fn()));
    await act(async () => { await result.current.act(vault(), secret, "copy"); });
    expect(result.current.unlocked).toBe(false);
  });

  it("copy-to: notifies with copiedText on success", async () => {
    const b = bridge();
    const notify = vi.fn();
    const reload = vi.fn();
    const { result } = renderHook(() => useVaultActions(b, { vaults: [vault()] }, reload, notify));
    await act(async () => { await result.current.act(vault(), secret, "copy-to:/dev/notes"); });
    expect(b.copyTo).toHaveBeenCalledWith("github:o/web", "API_KEY", "development", "/dev/notes");
    expect(notify).toHaveBeenCalledWith("Copied API_KEY in notes");
    expect(reload).toHaveBeenCalled();
  });

  it("edit: opens the Change form in the right vault with `from` set", async () => {
    const b = bridge();
    const { result } = renderHook(() => useVaultActions(b, { vaults: [vault()] }, vi.fn(), vi.fn()));
    await act(async () => { await result.current.act(vault(), secret, "edit"); });
    expect(result.current.editing).toEqual({
      vault: "github:o/web",
      folder: "/dev/web",
      name: "API_KEY",
      environments: ["development"],
      value: "",
      fixed: true,
      from: "development",
      blank: false,
    });
  });

  it("choose-remove: opens the remove dialog with the secret", async () => {
    const b = bridge();
    const { result } = renderHook(() => useVaultActions(b, { vaults: [vault()] }, vi.fn(), vi.fn()));
    await act(async () => { await result.current.act(vault(), secret, "choose-remove"); });
    expect(result.current.removing?.s).toBe(secret);
  });

  it("remove: runs the bridge and reloads", async () => {
    const b = bridge();
    const reload = vi.fn();
    const { result } = renderHook(() => useVaultActions(b, { vaults: [vault()] }, reload, vi.fn()));
    await act(async () => { await result.current.act(vault(), secret, "remove"); });
    expect(b.remove).toHaveBeenCalledWith("github:o/web", "API_KEY", "development");
    expect(reload).toHaveBeenCalled();
  });

  it("startImport: opens the import preview with default picks and the manage offer", async () => {
    const b = bridge();
    b.scan.mockResolvedValue({ id: "x", label: "x", files: [], rows: [{ file: ".env.local", name: "DB", environment: "development", status: "new", tail: "", public: false, ticked: true, skipped: false }] });
    const { result } = renderHook(() => useVaultActions(b, { vaults: [vault()] }, vi.fn(), vi.fn()));
    await act(async () => { await result.current.startImport(vault()); });
    expect(b.scan).toHaveBeenCalledWith("/dev/web");
    expect(result.current.importing?.picked.size).toBe(1);
  });

  it("finishImport: runs the bridge, takes over .env.local, notifies and reloads", async () => {
    const b = bridge();
    const writeBack = vi.fn();
    writeBack.mockResolvedValue({ written: true, file: ".env.local", gitignoreAdded: true });
    Object.assign(b, { writeBack });
    b.scan.mockResolvedValue({
      id: "x",
      label: "x",
      files: [{ file: ".env.local", environment: "development", namesOnly: false, tracked: false, vercel: false }],
      rows: [{ file: ".env.local", name: "DB", environment: "development", status: "new", tail: "", public: false, ticked: true, skipped: false }],
    });
    const reload = vi.fn();
    const notify = vi.fn();
    const { result } = renderHook(() => useVaultActions(b, { vaults: [vault()] }, reload, notify));
    await act(async () => { await result.current.startImport(vault()); });
    await act(async () => { await result.current.finishImport(); });
    expect(b.import).toHaveBeenCalled();
    expect(writeBack).toHaveBeenCalledWith("/dev/web");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Weft now writes .env.local"));
    expect(reload).toHaveBeenCalled();
  });

  it("save: addBlank when value is empty, set otherwise", async () => {
    const b = bridge();
    const reload = vi.fn();
    const { result } = renderHook(() => useVaultActions(b, { vaults: [vault()] }, reload, vi.fn()));
    await act(async () => {
      await result.current.save({ vault: "github:o/web", folder: "/dev/web", name: "OPENAI", environments: ["development"], value: "", fixed: false });
    });
    expect(b.addBlank).toHaveBeenCalledWith("/dev/web", "OPENAI", "development");
    expect(b.set).not.toHaveBeenCalled();
  });

  it("save: change a value and remove it from `from` when unticked", async () => {
    const b = bridge();
    const reload = vi.fn();
    const { result } = renderHook(() => useVaultActions(b, { vaults: [vault()] }, reload, vi.fn()));
    await act(async () => {
      await result.current.save({ vault: "github:o/web", folder: "/dev/web", name: "API_KEY", environments: ["production"], value: "new", fixed: true, from: "development" });
    });
    expect(b.set).toHaveBeenCalledWith("/dev/web", "API_KEY", "production", "new");
    expect(b.remove).toHaveBeenCalledWith("github:o/web", "API_KEY", "development");
  });

  it("lock: clears revealed, editing and unlocks the vault", async () => {
    const b = bridge();
    const { result } = renderHook(() => useVaultActions(b, { vaults: [vault()] }, vi.fn(), vi.fn()));
    await act(async () => { await result.current.act(vault(), secret, "reveal"); });
    expect(result.current.unlocked).toBe(true);
    act(() => { result.current.lock(); });
    expect(result.current.revealed.size).toBe(0);
    expect(result.current.unlocked).toBe(false);
    expect(b.lock).toHaveBeenCalled();
  });

  it("menu: pops the menu and runs the picked action", async () => {
    const popupMenu = vi.fn();
    popupMenu.mockResolvedValue("reveal");
    (window as unknown as { weft: unknown }).weft = { popupMenu };
    const b = bridge();
    const { result } = renderHook(() => useVaultActions(b, { vaults: [vault()] }, vi.fn(), vi.fn()));
    const evt = { preventDefault: vi.fn() } as unknown as React.MouseEvent;
    await act(async () => { await result.current.menu(vault(), secret, evt); });
    expect(popupMenu).toHaveBeenCalled();
    expect(b.reveal).toHaveBeenCalled();
  });
});

describe("useVaultActions edge cases", () => {
  const scan = { files: [{ file: ".env", names: ["A"] }], existing: [] } as never;
  const evt = (preventDefault = vi.fn()) => ({ preventDefault }) as unknown as React.MouseEvent;

  it("toasts when a scan, a reveal or a change fails", async () => {
    const b = bridge();
    b.scan.mockRejectedValue(new Error("scan boom"));
    b.reveal.mockRejectedValue(new Error("reveal boom"));
    b.remove.mockRejectedValue(new Error("remove boom"));
    const notify = vi.fn();
    const { result } = renderHook(() => useVaultActions(b, null, vi.fn(), notify));
    await act(async () => { await result.current.startImport(vault()); });
    await act(async () => { await result.current.act(vault(), secret, "reveal"); });
    await act(async () => { await result.current.act(vault(), secret, "remove"); });
    expect(notify.mock.calls.map(([e]) => (e as Error).message)).toEqual(["scan boom", "reveal boom", "remove boom"]);
    expect(result.current.busy).toBe(false);
  });

  it("does nothing without a bridge", async () => {
    const reload = vi.fn();
    const { result } = renderHook(() => useVaultActions(null, null, reload, vi.fn()));
    await act(async () => {
      await result.current.startImport(vault());
      await result.current.act(vault(), secret, "reveal");
      await result.current.finishImport();
      await result.current.save({ vault: "v", folder: "/f", name: "A", environments: ["development"], value: "x", fixed: false });
      await result.current.removeFromVault("v", "A", ["development"]);
      result.current.lock();
    });
    expect(result.current.revealed.size).toBe(0);
    expect(reload).not.toHaveBeenCalled();
  });

  it("toggles rows in the import preview, and ignores a toggle with no import open", async () => {
    const b = bridge();
    b.scan.mockResolvedValue(scan);
    const { result } = renderHook(() => useVaultActions(b, null, vi.fn(), vi.fn()));
    act(() => result.current.toggleImport("x"));
    expect(result.current.importing).toBeNull();
    await act(async () => { await result.current.startImport(vault()); });
    act(() => result.current.setImporting({ folder: "/f", scan, picked: new Set(["a"]), manage: null }));
    act(() => result.current.toggleImport("b"));
    expect([...(result.current.importing?.picked ?? [])]).toEqual(["a", "b"]);
    act(() => result.current.toggleImport("a"));
    expect([...(result.current.importing?.picked ?? [])]).toEqual(["b"]);
  });

  it("finishImport does nothing when no import is open", async () => {
    const b = bridge();
    const { result } = renderHook(() => useVaultActions(b, null, vi.fn(), vi.fn()));
    await act(async () => { await result.current.finishImport(); });
    expect(b.import).not.toHaveBeenCalled();
  });

  it("removeFromVault removes from each environment and closes the dialog", async () => {
    const b = bridge();
    const reload = vi.fn();
    const { result } = renderHook(() => useVaultActions(b, null, reload, vi.fn()));
    act(() => result.current.setRemoving({ v: vault(), s: secret }));
    await act(async () => { await result.current.removeFromVault("github:o/web", "API_KEY", ["development", "preview"]); });
    expect(b.remove.mock.calls).toEqual([
      ["github:o/web", "API_KEY", "development"],
      ["github:o/web", "API_KEY", "preview"],
    ]);
    expect(result.current.removing).toBeNull();
    expect(reload).toHaveBeenCalled();
  });

  it("menu does nothing without Electron's popup, and nothing when the menu is dismissed", async () => {
    const b = bridge();
    const { result } = renderHook(() => useVaultActions(b, { vaults: [vault(), vault({ id: "other", label: "o/other", folder: "/dev/other" })] }, vi.fn(), vi.fn()));
    const prevent = vi.fn();
    await act(async () => { await result.current.menu(vault(), secret, evt(prevent)); });
    expect(prevent).not.toHaveBeenCalled();

    const popupMenu = vi.fn().mockResolvedValue(null);
    (window as unknown as { weft: unknown }).weft = { popupMenu };
    await act(async () => { await result.current.menu(vault(), secret, evt()); });
    expect(popupMenu).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(popupMenu.mock.calls[0])).toContain("copy-to:/dev/other");
    expect(b.reveal).not.toHaveBeenCalled();
  });

  it("menu's Remove asks which environments", async () => {
    (window as unknown as { weft: unknown }).weft = { popupMenu: vi.fn().mockResolvedValue("remove") };
    const b = bridge();
    const { result } = renderHook(() => useVaultActions(b, null, vi.fn(), vi.fn()));
    await act(async () => { await result.current.menu(vault(), secret, evt()); });
    expect(result.current.removing?.s).toBe(secret);
    expect(b.remove).not.toHaveBeenCalled();
  });
});
