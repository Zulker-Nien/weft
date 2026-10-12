-- Supabase's ensure_rls event trigger function sits in public, so the Data API lists it as an RPC.
-- Event triggers don't check EXECUTE, so revoking it keeps the trigger working and the RPC closed.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
