"use client";

import { useLinkedStatus } from "./use-linked-status";
import { supabaseBridge } from "./supabase-view";

// The board folders' Supabase links, from Electron main, cached between opens (lib/use-linked-status.ts).
export function useSupabase(folders: string[], active: boolean) {
  return useLinkedStatus("supabase", supabaseBridge(), folders, active);
}
