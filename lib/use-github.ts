"use client";

import { api } from "./client";
import { useLinkedStatus } from "./use-linked-status";

// The board folders' GitHub repos and issue sync, from the Next server (gh runs there, so no Electron bridge is
// needed), cached between opens like the other drawers (lib/use-linked-status.ts).
const GITHUB = { status: (folders: string[]) => api.github(folders) };

export function useGithub(folders: string[], active: boolean) {
  return useLinkedStatus("github", GITHUB, folders, active);
}
