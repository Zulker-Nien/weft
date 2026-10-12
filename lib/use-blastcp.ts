"use client";

import { useLinkedStatus } from "./use-linked-status";
import { blastcpBridge } from "./blastcp-view";

// The board folders' BlastCP properties, from Electron main, cached between opens (lib/use-linked-status.ts).
export function useBlastcp(folders: string[], active: boolean) {
  return useLinkedStatus("blastcp", blastcpBridge(), folders, active);
}
