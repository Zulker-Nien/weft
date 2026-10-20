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
  it("says which team is on screen: the server default until you pick one", () => {
    useTeamMock.mockImplementation((org) => (org ? hook({ kind: "loading" }) : ok("acme")));
    const { result } = renderHook(() => useManagedTeam());
    expect(result.current.selected).toBe("acme");
    act(() => result.current.setOrg("weft"));
    expect(result.current.selected).toBe("weft");
  });

  it("keeps the team you switched from while the next one loads", () => {
    const acmeTeam = ok("acme");
    useTeamMock.mockImplementation((org) => (org ? hook({ kind: "loading" }) : acmeTeam));
    const { result } = renderHook(() => useManagedTeam());
    expect(result.current.last).toBe((acmeTeam.state as { team: unknown }).team);
    act(() => result.current.setOrg("weft"));
    expect(result.current.state.kind).toBe("loading");
    expect(result.current.last).toBe((acmeTeam.state as { team: unknown }).team);
  });

  it("has nothing to keep before any team has loaded", () => {
    useTeamMock.mockReturnValue(hook({ kind: "loading" }));
    const { result } = renderHook(() => useManagedTeam());
    act(() => result.current.setOrg("weft"));
    expect(result.current.last).toBeNull();
    expect(result.current.selected).toBe("weft");
  });
});
