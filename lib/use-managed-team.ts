"use client";

import { useState } from "react";
import type { TeamSnapshot } from "./team-types";
import { readSavedOrg, saveOrg, stillListed } from "./team-view";
import { useTeam, type TeamHook } from "./use-team";

export type ManagedTeam = TeamHook & {
  setOrg: (slug: string) => void;
  // The workspace on screen: the one you picked, else the server default once it has loaded.
  selected: string | undefined;
  // The workspace on screen, or while a switch loads (or fails) the one you switched from, so Settings → Teams
  // keeps listing your teams.
  last: TeamSnapshot | null;
};

// useTeam on the workspace you last managed (localStorage `weft-team-org`), else the server's default one.
// A remembered workspace you're no longer in, or that's gone, falls back to the default.
export function useManagedTeam(): ManagedTeam {
  const [org, setOrgState] = useState<string | undefined>(() => (typeof window === "undefined" ? undefined : readSavedOrg()));
  const [last, setLast] = useState<TeamSnapshot | null>(null);
  const team = useTeam(org);
  const { state } = team;

  const gone =
    !!org &&
    ((state.kind === "ok" && state.team.org.slug === org && !stillListed(org, state.team.orgs)) ||
      (state.kind === "error" && state.message === "No workspace found."));
  // Adjusting state while rendering (React's pattern for a value derived from another state).
  if (gone) {
    saveOrg(undefined);
    setOrgState(undefined);
  }

  const setOrg = (slug: string) => {
    if (state.kind === "ok") setLast(state.team);
    saveOrg(slug);
    setOrgState(slug);
  };
  const selected = org ?? (state.kind === "ok" ? state.team.org.slug : undefined);
  return { ...team, setOrg, selected, last: state.kind === "ok" ? state.team : last };
}
