// The Users admin page's data source. Returns paginated rows of weft.zip
// accounts (auth.users joined to profiles) for the table. The admin gate
// (@/lib/admin) has already verified the caller is a super-admin; the service
// client is what reads across users (RLS on profiles allows only self-read).
import { adminServiceClient, requireSuperAdminWeft } from "@/lib/admin";
import { fail, guard } from "@/lib/guard";
import { escapeLikeWildcards, normalizeEmail } from "@aimhuge/teams";

const PAGE_SIZE = 20;
const MAX_SKIP = 100 * PAGE_SIZE;

export interface AdminUserRow {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  provider: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
}

// The auth.users shape as it lands from PostgREST. The fields are nullable
// because Supabase types them loosely, and `raw_user_meta_data` is
// `Record<string, unknown>` — three different `user_metadata` shapes over the
// years, plus service-role JSONB without a fixed schema.
interface AuthUserRow {
  id: string;
  email: string | null;
  raw_user_meta_data: Record<string, unknown> | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  app_metadata: { provider?: unknown } | null;
}

interface ProfileRow {
  id: string;
  name: string | null;
  avatar_url: string | null;
}

// The whitelisted sort columns. Anything else would be an injection surface.
const SORTABLE: Record<string, string> = {
  created_at: "created_at",
  last_sign_in_at: "last_sign_in_at",
  email: "email",
};

function parseSort(sort: string): { column: string; dir: "asc" | "desc" } {
  const [field, dirRaw] = sort.split(/\s+/, 2);
  const dir = dirRaw === "asc" ? "asc" : "desc";
  return { column: SORTABLE[field ?? ""] ?? "created_at", dir };
}

function parseInt32(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function pickString(meta: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === "string" && v !== "") return v;
  }
  return null;
}

function mapUserToRow(
  u: AuthUserRow,
  profiles: Map<string, { name: string | null; avatar_url: string | null }>,
): AdminUserRow {
  const meta = u.raw_user_meta_data ?? {};
  const profile = profiles.get(u.id);
  const provider = typeof u.app_metadata?.provider === "string" ? u.app_metadata.provider : null;
  return {
    id: u.id,
    email: u.email,
    name: profile?.name ?? pickString(meta, "full_name", "name", "user_name"),
    avatarUrl: profile?.avatar_url ?? pickString(meta, "avatar_url", "picture"),
    provider,
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at,
  };
}

async function loadProfilesFor(
  service: { from: (t: string) => { select: (cols: string) => unknown } },
  ids: string[],
): Promise<Map<string, { name: string | null; avatar_url: string | null }>> {
  const map = new Map<string, { name: string | null; avatar_url: string | null }>();
  if (ids.length === 0) return map;
  // The duck-typed `service` shape (selected fields the route reads) is a
  // property, not a type, of SupabaseClient; the union of all the from/select
  // chains we build would force TS into infinite generics.
  const chain = service.from("profiles").select("id, name, avatar_url") as { in: (col: string, ids: string[]) => Promise<{ data: ProfileRow[] | null }> };
  const { data: profiles } = await chain.in("id", ids);
  for (const p of profiles ?? []) map.set(p.id, { name: p.name, avatar_url: p.avatar_url });
  return map;
}

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  try {
    await requireSuperAdminWeft();
    const url = new URL(req.url);
    const skip = Math.min(Math.max(parseInt32(url.searchParams.get("skip"), 0), 0), MAX_SKIP);
    const take = Math.min(Math.max(parseInt32(url.searchParams.get("take"), PAGE_SIZE), 1), PAGE_SIZE);
    const q = (url.searchParams.get("q") ?? "").trim();
    const sort = parseSort(url.searchParams.get("sort") ?? "created_at desc");
    const service = await adminServiceClient();
    if (!service) {
      return Response.json(
        {
          error: "SUPABASE_SECRET_KEY is not set. The Users admin page needs the service role on the deployed weft.",
          rows: [],
          total: 0,
        },
        { status: 503 },
      );
    }

    const emailTerm = q ? normalizeEmail(q) : "";

    // The page. Two more queries than a join would be (a second select for
    // profiles), but the join on auth.users.id is awkward through PostgREST
    // (the foreign-key side reads cleanly, the auth.users side doesn't), and
    // two short round-trips are easier to read than one with a hint comment.
    let page = service
      .from("auth.users")
      .select("id, email, raw_user_meta_data, created_at, last_sign_in_at, app_metadata")
      .order(sort.column, { ascending: sort.dir === "asc" })
      .range(skip, skip + take - 1);
    if (emailTerm) page = page.ilike("email", `%${escapeLikeWildcards(emailTerm)}%`);
    const { data: users, error: usersErr } = await page;
    if (usersErr) throw usersErr;

    const list = (users as AuthUserRow[] | null) ?? [];
    const profiles = await loadProfilesFor(service, list.map((u) => u.id));
    const rows = list.map((u) => mapUserToRow(u, profiles));

    let count = service.from("auth.users").select("id", { count: "exact", head: true });
    if (emailTerm) count = count.ilike("email", `%${escapeLikeWildcards(emailTerm)}%`);
    const { count: total, error: countErr } = await count;
    if (countErr) throw countErr;

    return Response.json({ rows, total: total ?? rows.length });
  } catch (err) {
    return fail(err);
  }
}
