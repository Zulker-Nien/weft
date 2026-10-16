import { afterEach, describe, expect, it, vi } from "vitest";

// /api/admin/gate, /api/admin/users, /api/admin/local. The admin gate is the same
// requireSuperAdminWeft() in all three, mocked here; the route-specific logic
// (json shape, env-driven service key, fs reads) is what each describe covers.

vi.mock("next/server", () => ({ connection: async () => {} }));

const adminMock = vi.hoisted(() => ({
  requireSuperAdminWeft: vi.fn(),
  isAdminWeft: vi.fn(),
  adminServiceClient: vi.fn(),
}));
vi.mock("@/lib/admin", () => adminMock);

const gate = await import("./admin/gate/route");
const users = await import("./admin/users/route");
const localRoute = await import("./admin/local/route");

const READ = { host: "127.0.0.1:3457" } as const;

function get(route: { GET: (req: Request) => Promise<Response> }, path: string, headers: Record<string, string> = READ) {
  return route.GET(new Request(`http://127.0.0.1:3457${path}`, { headers }));
}

const body = (res: Response) => res.json() as Promise<Record<string, unknown>>;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("/api/admin/gate", () => {
  it("returns { admin: true } when the signed-in Weft account is on SUPER_ADMIN_EMAILS", async () => {
    adminMock.isAdminWeft.mockResolvedValueOnce(true);
    const res = await get(gate, "/api/admin/gate");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admin: true });
  });

  it("returns { admin: false } for everyone else", async () => {
    adminMock.isAdminWeft.mockResolvedValueOnce(false);
    const res = await get(gate, "/api/admin/gate");
    expect(await res.json()).toEqual({ admin: false });
  });

  it("refuses non-localhost hosts", async () => {
    const res = await get(gate, "/api/admin/gate", { host: "evil.com" });
    expect(res.status).toBe(403);
    expect(adminMock.isAdminWeft).not.toHaveBeenCalled();
  });

  it("returns 500 when the gate throws", async () => {
    adminMock.isAdminWeft.mockRejectedValueOnce(new Error("disk"));
    const res = await get(gate, "/api/admin/gate");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "disk" });
  });
});

describe("/api/admin/users", () => {
  it("refuses unauthenticated callers (gate runs first)", async () => {
    adminMock.requireSuperAdminWeft.mockRejectedValueOnce(new Error("NEXT_NOT_FOUND"));
    const res = await get(users, "/api/admin/users");
    // fail() defaults to 400; the route uses the default rather than 500.
    expect(res.status).toBe(400);
    expect(adminMock.adminServiceClient).not.toHaveBeenCalled();
  });

  it("returns 503 with rows: [] when SUPABASE_SECRET_KEY is missing", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce({ email: "ada@b.co", user: { id: "u1", email: "ada@b.co", name: "Ada", avatar: null, provider: "github" } });
    adminMock.adminServiceClient.mockResolvedValueOnce(null);
    const res = await get(users, "/api/admin/users");
    expect(res.status).toBe(503);
    const data = await body(res);
    expect(typeof data.error).toBe("string");
    expect(data.error as string).toMatch(/SUPABASE_SECRET_KEY/);
    expect(data.rows).toEqual([]);
    expect(data.total).toBe(0);
  });

  it("returns paginated rows + total when the service client is available", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce({ email: "ada@b.co", user: { id: "u1", email: "ada@b.co", name: "Ada", avatar: null, provider: "github" } });

    // Two query builders: the page + the count. They each chain .order / .range / .ilike.
    const buildPageChain = (): PageChain & Thenable<{ data: unknown[]; error: null }> => {
      const chain: PageChain & Thenable<{ data: unknown[]; error: null }> = {
        order: vi.fn(() => chain),
        range: vi.fn(() => chain),
        ilike: vi.fn(() => chain),
        then: (onFulfilled) => Promise.resolve({ data: FIXTURE_USERS, error: null }).then(onFulfilled),
      };
      return chain;
    };
    const buildCountChain = (): CountChain & Thenable<{ count: number; error: null }> => {
      const chain: CountChain & Thenable<{ count: number; error: null }> = {
        ilike: vi.fn(() => chain),
        then: (onFulfilled) => Promise.resolve({ count: FIXTURE_USERS.length, error: null }).then(onFulfilled),
      };
      return chain;
    };

    const service = {
      from(table: string) {
        if (table === "auth.users") {
          const sel = vi.fn();
          // First call: the page. Second call (from `count`): the head:true count.
          sel.mockReturnValueOnce(buildPageChain());
          sel.mockReturnValueOnce(buildCountChain());
          return { select: sel };
        }
        if (table === "profiles") {
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => Promise.resolve({ data: FIXTURE_PROFILES, error: null })),
            })),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    adminMock.adminServiceClient.mockResolvedValueOnce(service);

    const res = await get(users, "/api/admin/users?skip=0&take=20&sort=created_at+desc");
    expect(res.status).toBe(200);
    const data = await body(res);
    const rows = data.rows as Array<Record<string, unknown>>;
    expect(data.total).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "u1", email: "ada@b.co", name: "Ada", provider: "github" });
    // u2 isn't in FIXTURE_PROFILES and its raw_user_meta_data is empty, so the
    // row's name falls through to null — that's the join behavior we want.
    expect(rows[1]).toMatchObject({ id: "u2", email: "lin@b.co", name: null, provider: "google" });
  });

  it("filters by q (email ilike) when search is set", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce({ email: "ada@b.co", user: { id: "u1", email: "ada@b.co", name: "Ada", avatar: null, provider: "github" } });

    let iliked = "";
    const pageChain: PageChain & Thenable<{ data: unknown[]; error: null }> = {
      order: vi.fn(function (this: unknown) { return this; }),
      range: vi.fn(function (this: unknown) { return this; }),
      ilike: vi.fn(function (this: unknown, _col: string, pattern: string) { iliked = pattern; return this; }),
      then: (onFulfilled) => Promise.resolve({ data: [], error: null }).then(onFulfilled),
    };
    const countChain: CountChain & Thenable<{ count: number; error: null }> = {
      ilike: vi.fn(function (this: unknown, _col: string, pattern: string) { if (!iliked) iliked = pattern; return this; }),
      then: (onFulfilled) => Promise.resolve({ count: 0, error: null }).then(onFulfilled),
    };
    let authCalls = 0;
    const service = {
      from(table: string) {
        if (table === "auth.users") {
          authCalls += 1;
          const sel = vi.fn();
          sel.mockReturnValueOnce(pageChain);
          sel.mockReturnValueOnce(countChain);
          return { select: sel };
        }
        if (table === "profiles") {
          return { select: vi.fn(() => ({ in: vi.fn(() => Promise.resolve({ data: [], error: null })) })) };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    adminMock.adminServiceClient.mockResolvedValueOnce(service);

    await get(users, "/api/admin/users?q=ada");
    expect(iliked).toBe("%ada%");
    expect(authCalls).toBe(2);
  });

  it("rejects non-localhost hosts", async () => {
    const res = await get(users, "/api/admin/users", { host: "evil.com" });
    expect(res.status).toBe(403);
    expect(adminMock.requireSuperAdminWeft).not.toHaveBeenCalled();
  });
});

describe("/api/admin/local", () => {
  it("returns the local overview when the gate clears", async () => {
    adminMock.requireSuperAdminWeft.mockResolvedValueOnce({ email: "ada@b.co", user: { id: "u1", email: "ada@b.co", name: "Ada", avatar: null, provider: "github" } });
    const res = await get(localRoute, "/api/admin/local");
    // The route reads the real DATA_DIR; the shape is what we care about.
    expect(res.status).toBe(200);
    const data = await body(res);
    expect(typeof data.dataDir).toBe("string");
    expect(typeof data.version).toBe("string");
    expect(typeof data.uptime).toBe("number");
    const board = data.board as Record<string, unknown>;
    expect(typeof board.cards).toBe("number");
    expect(typeof board.archived).toBe("number");
    expect(typeof board.threads).toBe("number");
    const activity = data.activity as Record<string, unknown>;
    expect(typeof activity.entries).toBe("number");
    const pages = data.pages as Record<string, unknown>;
    expect(typeof pages.count).toBe("number");
    expect(typeof pages.bytes).toBe("number");
    expect(typeof data.settings).toBe("object");
  });

  it("refuses unauthenticated callers", async () => {
    adminMock.requireSuperAdminWeft.mockRejectedValueOnce(new Error("NEXT_NOT_FOUND"));
    const res = await get(localRoute, "/api/admin/local");
    expect(res.status).toBe(400);
  });

  it("rejects non-localhost hosts", async () => {
    const res = await get(localRoute, "/api/admin/local", { host: "evil.com" });
    expect(res.status).toBe(403);
  });
});

const FIXTURE_USERS: AuthUser[] = [
  {
    id: "u1",
    email: "ada@b.co",
    raw_user_meta_data: { full_name: "Ada", avatar_url: "https://img/ada.png" },
    created_at: "2025-01-01T00:00:00Z",
    last_sign_in_at: "2026-10-01T00:00:00Z",
    app_metadata: { provider: "github" },
  },
  {
    id: "u2",
    email: "lin@b.co",
    raw_user_meta_data: {},
    created_at: "2025-06-01T00:00:00Z",
    last_sign_in_at: null,
    app_metadata: { provider: "google" },
  },
];

const FIXTURE_PROFILES: ProfileFixture[] = [
  { id: "u1", name: "Ada", avatar_url: "https://img/ada.png" },
];

interface AuthUser {
  id: string;
  email: string;
  raw_user_meta_data: Record<string, unknown>;
  created_at: string;
  last_sign_in_at: string | null;
  app_metadata: { provider?: string };
}

interface ProfileFixture {
  id: string;
  name: string;
  avatar_url: string;
}

interface Thenable<T> {
  then: <U>(onFulfilled: (value: T) => U) => Promise<U>;
}

interface PageChain {
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  ilike: ReturnType<typeof vi.fn>;
}

interface CountChain {
  ilike: ReturnType<typeof vi.fn>;
}
