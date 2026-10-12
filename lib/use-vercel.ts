"use client";

import { useLinkedStatus } from "./use-linked-status";
import { vercelBridge } from "./vercel-view";

// The board folders' Vercel links, from Electron main, cached between opens (lib/use-linked-status.ts).
export function useVercel(folders: string[], active: boolean) {
  return useLinkedStatus("vercel", vercelBridge(), folders, active);
}
