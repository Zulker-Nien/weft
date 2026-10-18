// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamHook } from "./use-team";
import { useManagedTeam } from "./use-managed-team";

const useTeamMock = vi.hoisted(() => vi.fn<(org?: string) => TeamHook>());
vi.mock("./use-team", () => ({ useTeam: useTeamMock }));

const acme = { id: "1", slug: "acme", name: "Acme" };
const hook = (state: TeamHook["state"]): TeamHook => ({ state, refresh: vi.fn(), actions: {} as TeamHook["actions"] });
const ok = (slug: string) => hook({ kind: "ok", team: { org: { ...acme, slug }, orgs: [acme] } as never });

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useManagedTeam", () => {
  it("starts on the server default and remembers a switch", () => {
    useTeamMock.mockReturnValue(ok("acme"));
    const { result } = renderHook(() => useManagedTeam());
    expect(useTeamMock).toHaveBeenLastCalledWith(undefined);
    act(() => result.current.setOrg("weft"));
    expect(window.localStorage.getItem("weft-team-org")).toBe("weft");
    expect(useTeamMock).toHaveBeenLastCalledWith("weft");
  });

  it("drops a remembered team that is no longer listed", () => {
    window.localStorage.setItem("weft-team-org", "gone");
    useTeamMock.mockImplementation((org) => (org ? ok("gone") : ok("acme")));
    renderHook(() => useManagedTeam());
    expect(useTeamMock).toHaveBeenLastCalledWith(undefined);
    expect(window.localStorage.getItem("weft-team-org")).toBeNull();
  });

  it("drops it on a 'No workspace found.' answer", () => {
    window.localStorage.setItem("weft-team-org", "gone");
    useTeamMock.mockImplementation((org) => (org ? hook({ kind: "error", message: "No workspace found." }) : ok("acme")));
    renderHook(() => useManagedTeam());
    expect(useTeamMock).toHaveBeenLastCalledWith(undefined);
  });
});
