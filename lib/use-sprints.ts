"use client";

import { useEffect, useSyncExternalStore } from "react";
import { call } from "./client-api";
import type { Sprint } from "./sprints";

// The saved sprints (app/api/sprints), shared by the Backlog header's Save as sprint and the sprints
// list under "Backlog": one list in memory, so a sprint saved in one shows in the other at once.

let sprints: Sprint[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function set(next: Sprint[]) {
  sprints = next;
  loaded = true;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const sprintsApi = {
  list: () => call<{ sprints: Sprint[] }>("GET", "/api/sprints"),
  save: (cardIds: string[], name?: string) => call<{ sprint: Sprint }>("POST", "/api/sprints", { cardIds, name }),
  rename: (id: string, name: string) => call<{ sprint: Sprint }>("PATCH", "/api/sprints", { id, name }),
  remove: (id: string) => call<{ ok: true }>("DELETE", "/api/sprints", { id }),
};

export function reloadSprints() {
  return sprintsApi.list().then(({ sprints: next }) => set(next));
}

// Each change goes to the server, then the list reloads from it, so every view agrees with sprints.json.
export const sprintActions = {
  save: async (cardIds: string[], name?: string) => {
    const { sprint } = await sprintsApi.save(cardIds, name);
    await reloadSprints();
    return sprint;
  },
  rename: (id: string, name: string) => sprintsApi.rename(id, name).then(reloadSprints),
  remove: (id: string) => sprintsApi.remove(id).then(reloadSprints),
};

export function useSprints(): Sprint[] {
  const list = useSyncExternalStore(subscribe, () => sprints, () => sprints);
  useEffect(() => {
    if (!loaded) void reloadSprints().catch(() => {});
  }, []);
  return list;
}

// For tests: forget the list so the next hook loads it again.
export function resetSprints() {
  sprints = [];
  loaded = false;
  listeners.clear();
}
