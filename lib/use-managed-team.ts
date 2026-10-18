"use client";

import { useState } from "react";
import { readSavedOrg, saveOrg, stillListed } from "./team-view";
import { useTeam, type TeamHook } from "./use-team";

// useTeam on the workspace you last managed (localStorage `weft-team-org`), else the server's default one.
// A remembered workspace you're no longer in, or that's gone, falls back to the default.
export function useManagedTeam(): TeamHook & { setOrg: (slug: string) => void } {
  const [org, setOrgState] = useState<string | undefined>(() => (typeof window === "undefined" ? undefined : readSavedOrg()));
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
    saveOrg(slug);
    setOrgState(slug);
  };
  return { ...team, setOrg };
}
