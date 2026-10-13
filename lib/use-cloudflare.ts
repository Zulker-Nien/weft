"use client";

import { cloudflareBridge } from "./cloudflare-view";
import { useLinkedStatus } from "./use-linked-status";

// The board folders' Cloudflare links, from Electron main, cached between opens (lib/use-linked-status.ts).
export function useCloudflare(folders: string[], active: boolean) {
  return useLinkedStatus("cloudflare", cloudflareBridge(), folders, active);
}
