// Weft prod's Supabase project. The publishable key is safe to ship in the app; row-level security guards the data.
// WEFT_SUPABASE_KEY="" turns accounts off. Its own module, free of Node imports, so proxy.ts can use it.
export const SUPABASE_URL = process.env.WEFT_SUPABASE_URL || "https://lqjyravglujyizyqypxq.supabase.co";
export const SUPABASE_KEY = process.env.WEFT_SUPABASE_KEY ?? "sb_publishable_DHNc-IYsRJSJkbN38qZNLQ_G59w6uVe";
