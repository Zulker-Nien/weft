// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sprint } from "./sprints";

// The shared list behind the Backlog header's Save as sprint and the sprints list (components/SprintsMenu.tsx).
// The fetch client is mocked; resetSprints() runs between tests so the module-level store starts empty.

type Body = { id?: string; name?: string };
const call = vi.fn<(method: string, url: string, body?: Body) => Promise<unknown>>();
vi.mock("./client-api", () => ({ call: (method: string, url: string, body?: Body) => call(method, url, body) }));

const { reloadSprints, resetSprints, sprintActions, useSprints } = await import("./use-sprints");

const a: Sprint = { id: "a", name: "Sprint 1", cardIds: ["x"], createdAt: 1 };
const b: Sprint = { id: "b", name: "Sprint 2", cardIds: ["y"], createdAt: 2 };
let onServer: Sprint[] = [];

beforeEach(() => {
  onServer = [];
  call.mockReset().mockImplementation((method, url, body) => {
    if (url !== "/api/sprints") return Promise.reject(new Error(`unexpected ${url}`));
    if (method === "GET") return Promise.resolve({ sprints: onServer });
    if (method === "POST") {
      onServer = [...onServer, b];
      return Promise.resolve({ sprint: b });
    }
    if (method === "PATCH") {
      onServer = onServer.map((s) => (s.id === body?.id ? { ...s, name: body.name ?? s.name } : s));
      return Promise.resolve({ sprint: onServer[0] });
    }
    onServer = onServer.filter((s) => s.id !== body?.id);
    return Promise.resolve({ ok: true });
  });
});

afterEach(() => {
  cleanup();
  resetSprints();
});

describe("useSprints", () => {
  it("starts empty, then loads the sprints once", async () => {
    onServer = [a];
    const { result } = renderHook(() => useSprints());
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toEqual([a]));
    renderHook(() => useSprints());
    expect(call.mock.calls.filter(([m]) => m === "GET")).toHaveLength(1);
  });

  it("save posts the cards, reloads and returns the new sprint", async () => {
    const { result } = renderHook(() => useSprints());
    let saved: Sprint | undefined;
    await act(async () => {
      saved = await sprintActions.save(["y"], "Launch");
    });
    expect(call).toHaveBeenCalledWith("POST", "/api/sprints", { cardIds: ["y"], name: "Launch" });
    expect(saved).toEqual(b);
    expect(result.current).toEqual([b]);
  });

  it("rename and remove go to the server and reload", async () => {
    onServer = [a, b];
    const { result } = renderHook(() => useSprints());
    await act(async () => {
      await sprintActions.rename("a", "Polish");
    });
    expect(result.current[0]!.name).toBe("Polish");
    await act(async () => {
      await sprintActions.remove("a");
    });
    expect(result.current).toEqual([b]);
  });

  it("a failed first load leaves the list empty", async () => {
    call.mockRejectedValueOnce(new Error("down"));
    const { result } = renderHook(() => useSprints());
    await waitFor(() => expect(call).toHaveBeenCalled());
    expect(result.current).toEqual([]);
    await act(async () => {
      await reloadSprints();
    });
    expect(result.current).toEqual([]);
  });
});
