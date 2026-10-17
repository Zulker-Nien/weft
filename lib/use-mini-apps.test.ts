// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MiniApp } from "./mini-apps";

// The shared list behind the apps sidebar (components/AppsRail.tsx) and the pane's Save as app
// (components/SaveAppButton.tsx). The fetch client is mocked; resetMiniApps() is called between
// tests so the module-level store starts empty every time.

const list = vi.fn<() => Promise<{ apps: MiniApp[] }>>();
const save = vi.fn<(url: string, name?: string) => Promise<{ app: MiniApp }>>();
const update = vi.fn<(id: string, patch: { name?: string; to?: number }) => Promise<{ app: MiniApp }>>();
const remove = vi.fn<(id: string) => Promise<{ ok: true }>>();
vi.mock("./client-api", () => ({ call: vi.fn(async (method: string, url: string, body?: unknown) => {
  if (method === "GET" && url === "/api/apps") return list();
  if (method === "POST" && url === "/api/apps") return save((body as { url: string; name?: string }).url, (body as { url: string; name?: string }).name);
  if (method === "PATCH" && url === "/api/apps") return update((body as { id: string; name?: string; to?: number }).id, { name: (body as { name?: string }).name, to: (body as { to?: number }).to });
  if (method === "DELETE" && url === "/api/apps") return remove((body as { id: string }).id);
  throw new Error(`unexpected ${method} ${url}`);
}) }));

const { appActions, reloadApps, resetMiniApps, useMiniApps } = await import("./use-mini-apps");

const a: MiniApp = { id: "a", name: "A", url: "https://a.test", addedAt: 1 };
const b: MiniApp = { id: "b", name: "B", url: "https://b.test", addedAt: 2 };

beforeEach(() => {
  list.mockReset().mockResolvedValue({ apps: [] });
  save.mockReset().mockResolvedValue({ app: a });
  update.mockReset().mockResolvedValue({ app: a });
  remove.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  resetMiniApps();
});

describe("useMiniApps", () => {
  it("starts empty, then loads the apps from the server", async () => {
    list.mockResolvedValueOnce({ apps: [a, b] });
    const { result } = renderHook(() => useMiniApps());
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toEqual([a, b]));
  });

  it("only loads once across many mounts", async () => {
    list.mockResolvedValueOnce({ apps: [a] });
    const first = renderHook(() => useMiniApps());
    await waitFor(() => expect(first.result.current).toEqual([a]));
    const second = renderHook(() => useMiniApps());
    expect(second.result.current).toEqual([a]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("swallows a failed initial load so the list stays empty", async () => {
    list.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useMiniApps());
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});

describe("appActions", () => {
  it("save sends POST /api/apps and reloads the list", async () => {
    list.mockResolvedValueOnce({ apps: [a] }).mockResolvedValueOnce({ apps: [a, b] });
    save.mockResolvedValueOnce({ app: b });
    const { result } = renderHook(() => useMiniApps());
    await waitFor(() => expect(result.current).toEqual([a]));
    await act(() => appActions.save("https://b.test"));
    expect(save).toHaveBeenCalledWith("https://b.test", undefined);
    expect(result.current).toEqual([a, b]);
  });

  it("save passes a name through to the server", async () => {
    list.mockResolvedValueOnce({ apps: [a] }).mockResolvedValueOnce({ apps: [a] });
    save.mockResolvedValueOnce({ app: a });
    const { result } = renderHook(() => useMiniApps());
    await waitFor(() => expect(result.current).toEqual([a]));
    await act(() => appActions.save("https://a.test", "Renamed"));
    expect(save).toHaveBeenCalledWith("https://a.test", "Renamed");
  });

  it("rename sends PATCH with only the new name", async () => {
    list.mockResolvedValueOnce({ apps: [a] }).mockResolvedValueOnce({ apps: [a] });
    update.mockResolvedValueOnce({ app: { ...a, name: "New" } });
    const { result } = renderHook(() => useMiniApps());
    await waitFor(() => expect(result.current).toEqual([a]));
    await act(() => appActions.rename("a", "New"));
    expect(update).toHaveBeenCalledWith("a", { name: "New" });
  });

  it("move sends PATCH with only the new position", async () => {
    list.mockResolvedValueOnce({ apps: [a, b] }).mockResolvedValueOnce({ apps: [b, a] });
    update.mockResolvedValueOnce({ app: a });
    const { result } = renderHook(() => useMiniApps());
    await waitFor(() => expect(result.current).toEqual([a, b]));
    await act(() => appActions.move("a", 1));
    expect(update).toHaveBeenCalledWith("a", { to: 1 });
  });

  it("remove sends DELETE and reloads the list", async () => {
    list.mockResolvedValueOnce({ apps: [a, b] }).mockResolvedValueOnce({ apps: [b] });
    const { result } = renderHook(() => useMiniApps());
    await waitFor(() => expect(result.current).toEqual([a, b]));
    await act(() => appActions.remove("a"));
    expect(remove).toHaveBeenCalledWith("a");
    expect(result.current).toEqual([b]);
  });

  it("propagates a failed save by rejecting the promise", async () => {
    list.mockResolvedValueOnce({ apps: [] });
    save.mockRejectedValueOnce(new Error("bad url"));
    const { result } = renderHook(() => useMiniApps());
    await waitFor(() => expect(result.current).toEqual([]));
    await expect(appActions.save("about:blank")).rejects.toThrow("bad url");
    expect(result.current).toEqual([]);
  });
});

describe("reloadApps", () => {
  it("updates the shared list with the server's reply", async () => {
    list.mockResolvedValueOnce({ apps: [a] }).mockResolvedValueOnce({ apps: [a, b] });
    const { result } = renderHook(() => useMiniApps());
    await waitFor(() => expect(result.current).toEqual([a]));
    await act(() => reloadApps());
    expect(result.current).toEqual([a, b]);
  });
});
