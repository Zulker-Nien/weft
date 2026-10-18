"use client";

import { useEffect, useState } from "react";
import { api } from "./client";

// The GitHub repos of the board's projects (GET /api/settings for the folders, then GET /api/github for each
// folder's remote), for the team's "Add project" picker. Folders with no GitHub remote are left out; a failure
// is an empty list, since the picker also takes a typed owner/name.
export function useBoardRepos(active: boolean): string[] {
  const [repos, setRepos] = useState<string[]>([]);
  useEffect(() => {
    if (!active) return;
    const live = { on: true };
    void (async () => {
      try {
        const settings = await api.settings();
        const status = await api.github(settings.projects.map((p) => p.path));
        const found = status.folders.map((f) => f.repo).filter((r): r is string => !!r);
        if (live.on) setRepos([...new Set(found)]);
      } catch {
        if (live.on) setRepos([]);
      }
    })();
    return () => {
      live.on = false;
    };
  }, [active]);
  return repos;
}
