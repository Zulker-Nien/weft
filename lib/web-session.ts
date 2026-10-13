// Who's signed in on weft.zip: a cookie session per visitor through @supabase/ssr. The desktop's own session
// (lib/account.ts) is a sealed file on your machine, so it can't stand for a visitor on the deployed site; the
// team pages (app/[orgSlug]/team, app/invite) and /login read this one instead. proxy.ts refreshes it on each
// request; Server Components only read it (they can't write cookies).
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SUPABASE_KEY, SUPABASE_URL } from "./supabase-project";

export type CookieOptions = Record<string, unknown>;
export type CookieJar = {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options?: CookieOptions): void;
};

// A Supabase client whose session lives in `jar`. Writes that the jar refuses (a Server Component's read-only
// cookies) are dropped: the proxy already refreshed the session for this request.
export function cookieClient(jar: CookieJar, url = SUPABASE_URL, key = SUPABASE_KEY) {
  return createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) jar.set(c.name, c.value, c.options);
        } catch {
          // Read-only cookies during a render.
        }
      },
    },
  });
}

export type WebClient = ReturnType<typeof cookieClient>;

// The current request's client (Server Components, Route Handlers, Server Actions).
export async function webClient(): Promise<WebClient> {
  return cookieClient(await cookies());
}

export type WebUser = { id: string; email: string | null; name: string | null; avatar: string | null };

// The signed-in visitor, from the cookie's JWT (verified against the project's keys), or null.
export async function webUser(client?: WebClient): Promise<WebUser | null> {
  const supabase = client ?? (await webClient());
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims.sub) return null;
  const claims = data.claims as Record<string, unknown>;
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const text = (...values: unknown[]) => values.find((v): v is string => typeof v === "string" && v !== "") ?? null;
  return {
    id: String(claims.sub),
    email: text(claims.email),
    name: text(meta.full_name, meta.name, meta.user_name),
    avatar: text(meta.avatar_url, meta.picture),
  };
}

// The service-role client for the deployed Weft's own writes (orgs, memberships, invites). The key is set on
// the Vercel deployment only (SUPABASE_SECRET_KEY); a Weft without it has no team pages.
const makeService = (key: string) => createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
let service: { key: string; client: ReturnType<typeof makeService> } | null = null;
export function serviceClient(env: Record<string, string | undefined> = process.env) {
  const key = env.SUPABASE_SECRET_KEY;
  if (!key) return null;
  if (service?.key !== key) service = { key, client: makeService(key) };
  return service.client;
}
