// Refreshes the weft.zip visitor's Supabase session cookie before the team pages render (lib/web-session.ts):
// Server Components can read cookies but not write them, so an expired access token is swapped here. Only on the
// deployed Weft; the desktop board's routes never match, and a local Weft passes straight through.
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase-project";

export async function proxy(request: NextRequest) {
  if (!(process.env.VERCEL || process.env.WEFT_HOME) || !SUPABASE_KEY) return NextResponse.next();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) request.cookies.set(c.name, c.value);
        response = NextResponse.next({ request });
        for (const c of list) response.cookies.set(c.name, c.value, c.options);
      },
    },
  });
  // getClaims refreshes an expired token through setAll; nothing between createServerClient and it.
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  // The weft.zip pages that read the session: sign-in, the workspace's team page and invite links.
  matcher: ["/login", "/app", "/team", "/invite/:token*", "/:orgSlug/team/:path*", "/:orgSlug/billing/:path*"],
};
