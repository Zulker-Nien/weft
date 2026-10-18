import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";

// The Weft account's Supabase client for the Mac's background posts (lib/league-sync.ts,
// lib/profile-card-sync.ts): null when accounts aren't set up in this build, and signedIn says whether
// there's anyone to post as.

export function safeClient(): SupabaseClient | null {
  try {
    return accountClient();
  } catch {
    return null;
  }
}

export async function signedIn(client: SupabaseClient): Promise<boolean> {
  const { data } = await client.auth.getSession();
  return Boolean(data.session);
}
