import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Instant issue sync by webhook: the github_hooks rows on your Weft account, the hook gh puts on the repo, and the
// Realtime channel that syncs a repo when its event arrives. The account's Supabase client, gh and
// lib/github-issues are fakes.

type Row = { id: string; repo: string; secret?: string; github_hook_id: number | null };

const fake = vi.hoisted(() => {
  const state = {
    uid: "u1" as string | null,
    rows: [] as Row[],
    error: null as { message: string } | null,
    nextId: 1,
    gh: [] as { args: string[]; input: string }[],
    ghResult: ((): string | Error => JSON.stringify({ id: 99 })) as (args: string[]) => string | Error,
    onChange: null as null | ((change: { new: { repo?: unknown } }) => void),
    onAuth: null as null | (() => void),
    channels: 0,
    removed: 0,
    throwClient: false,
  };

  function from(table: string) {
    if (table !== "github_hooks") throw new Error(table);
    let op = "select";
    let value: Partial<Row> = {};
    const where: [keyof Row, unknown][] = [];
    const matches = () => state.rows.filter((r) => where.every(([k, v]) => r[k] === v));
    const run = () => {
      if (state.error) return { data: null, error: state.error };
      if (op === "insert") {
        const row = { id: `h${state.nextId++}`, github_hook_id: null, ...value } as Row;
        state.rows.push(row);
        return { data: row, error: null };
      }
      if (op === "update") {
        for (const r of matches()) Object.assign(r, value);
        return { data: null, error: null };
      }
      if (op === "delete") {
        const gone = new Set(matches());
        state.rows = state.rows.filter((r) => !gone.has(r));
        return { data: null, error: null };
      }
      return { data: matches(), error: null };
    };
    const q = {
      select: () => q,
      insert: (row: Partial<Row>) => ((op = "insert"), (value = row), q),
      update: (patch: Partial<Row>) => ((op = "update"), (value = patch), q),
      delete: () => ((op = "delete"), q),
      eq: (k: keyof Row, v: unknown) => (where.push([k, v]), q),
      maybeSingle: () => {
        const r = run();
        return Promise.resolve(r.error ? r : { data: (r.data as Row[])[0] ?? null, error: null });
      },
      single: () => Promise.resolve(run()),
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  }

  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: state.uid ? { user: { id: state.uid } } : null } }),
      onAuthStateChange: (cb: () => void) => {
        state.onAuth = cb;
      },
    },
    from,
    channel: () => {
      state.channels++;
      const ch = {
        on: (_type: string, _filter: unknown, cb: (change: { new: { repo?: unknown } }) => void) => ((state.onChange = cb), ch),
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: () => {
      state.removed++;
      return Promise.resolve();
    },
  };
  return { state, client };
});

vi.mock("./account", () => ({
  accountClient: () => {
    if (fake.state.throwClient) throw new Error("Weft accounts aren't set up in this build yet.");
    return fake.client;
  },
}));

vi.mock("node:child_process", () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    const call = { args, input: "" };
    fake.state.gh.push(call);
    return {
      stdin: {
        end: (input: string) => {
          call.input = input;
          const out = fake.state.ghResult(args);
          setImmediate(() => (out instanceof Error ? cb(out, "", (out as Error & { stderr?: string }).stderr ?? "") : cb(null, out, "")));
        },
      },
    };
  },
}));

const issues = vi.hoisted(() => ({
  repoOf: vi.fn((folder: string) => Promise.resolve(folder === "/dev/web" ? "acme/web" : "acme/app")),
  issueSyncFolders: vi.fn((): string[] => []),
  issueSyncStatus: vi.fn((): Record<string, { repo?: string }> => ({})),
  syncIssues: vi.fn(() => Promise.resolve({ added: 0, updated: 0, archived: 0 })),
  ghError: (err: Error) => `gh: ${err.message}`,
}));
vi.mock("./github-issues", () => issues);

const hooks = await import("./github-hooks");

const ghFail = (stderr: string) => Object.assign(new Error("exit 1"), { stderr });

beforeEach(() => {
  Object.assign(fake.state, { uid: "u1", rows: [], error: null, nextId: 1, gh: [], onChange: null, onAuth: null, channels: 0, removed: 0, throwClient: false });
  fake.state.ghResult = () => JSON.stringify({ id: 99 });
  delete (globalThis as Record<string, unknown>).__weftGithubHooks;
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("hookedRepos", () => {
  it("lists your account's hooked repos", async () => {
    fake.state.rows = [{ id: "h1", repo: "acme/app", github_hook_id: 1 }];
    expect(await hooks.hookedRepos()).toEqual({ signedIn: true, repos: ["acme/app"] });
  });

  it("is empty when signed out or accounts are off, and throws a read error", async () => {
    fake.state.uid = null;
    expect(await hooks.hookedRepos()).toEqual({ signedIn: false, repos: [] });
    fake.state.throwClient = true;
    expect(await hooks.hookedRepos()).toEqual({ signedIn: false, repos: [] });
    fake.state.throwClient = false;
    fake.state.uid = "u1";
    fake.state.error = { message: "offline" };
    await expect(hooks.hookedRepos()).rejects.toThrow("offline");
  });
});

describe("addHook", () => {
  it("saves the hook, puts it on the repo with the secret on stdin, and listens", async () => {
    expect(await hooks.addHook("/dev/app")).toEqual({ repo: "acme/app" });
    expect(fake.state.rows).toEqual([{ id: "h1", repo: "acme/app", secret: expect.stringMatching(/^[0-9a-f]{64}$/) as string, github_hook_id: 99 }]);
    const call = fake.state.gh[0];
    const secret = fake.state.rows[0]?.secret ?? "missing";
    expect(call?.args).toEqual(["api", "repos/acme/app/hooks", "--method", "POST", "--input", "-"]);
    expect(call?.args.join(" ")).not.toContain(secret);
    expect(JSON.parse(call?.input ?? "") as unknown).toEqual({
      name: "web",
      active: true,
      events: ["issues"],
      config: { url: "https://weft-topaz.vercel.app/api/github/webhook?hook=h1", content_type: "json", secret, insecure_ssl: "0" },
    });
    expect(fake.state.channels).toBe(1);
  });

  it("leaves a repo that already has one, and doesn't open a second channel", async () => {
    fake.state.rows = [{ id: "h1", repo: "acme/app", github_hook_id: 5 }];
    await hooks.addHook("/dev/app");
    await hooks.addHook("/dev/app");
    expect(fake.state.gh).toEqual([]);
    expect(fake.state.channels).toBe(1);
  });

  it("keeps the row when GitHub gives no hook id", async () => {
    fake.state.ghResult = () => "{}";
    await hooks.addHook("/dev/app");
    expect(fake.state.rows[0]?.github_hook_id).toBeNull();
  });

  it("needs a Weft sign-in", async () => {
    fake.state.uid = null;
    await expect(hooks.addHook("/dev/app")).rejects.toThrow("Sign in to your Weft account");
  });

  it("forgets the row and says why when GitHub refuses", async () => {
    fake.state.ghResult = () => ghFail("gh: Not Found (HTTP 404)");
    await expect(hooks.addHook("/dev/app")).rejects.toThrow("Adding a webhook to acme/app needs admin rights on it.");
    expect(fake.state.rows).toEqual([]);
    fake.state.ghResult = () => ghFail("gh: something else (HTTP 500)");
    await expect(hooks.addHook("/dev/app")).rejects.toThrow("gh: exit 1");
  });

  it("passes on a database error, reading or adding", async () => {
    fake.state.error = { message: "offline" };
    await expect(hooks.addHook("/dev/app")).rejects.toThrow("offline");
    const real = fake.client.from;
    let calls = 0;
    fake.client.from = (table: string) => {
      const q = real(table);
      if (++calls === 2) fake.state.error = { message: "insert refused" };
      return q;
    };
    fake.state.error = null;
    await expect(hooks.addHook("/dev/app")).rejects.toThrow("insert refused");
    fake.client.from = real;
  });
});

describe("removeHook", () => {
  it("takes the hook off GitHub and the account, and stops listening with none left", async () => {
    await hooks.addHook("/dev/app");
    fake.state.gh = [];
    await hooks.removeHook("/dev/app");
    expect(fake.state.gh[0]?.args).toEqual(["api", "repos/acme/app/hooks/99", "--method", "DELETE"]);
    expect(fake.state.rows).toEqual([]);
    expect(fake.state.removed).toBe(1);
  });

  it("keeps listening while another repo has a hook", async () => {
    fake.state.rows = [
      { id: "h1", repo: "acme/app", github_hook_id: null },
      { id: "h2", repo: "acme/web", github_hook_id: 3 },
    ];
    await hooks.removeHook("/dev/app");
    expect(fake.state.gh).toEqual([]);
    expect(fake.state.rows.map((r) => r.repo)).toEqual(["acme/web"]);
    expect(fake.state.removed).toBe(0);
  });

  it("forgets a hook GitHub already lost, and throws on other gh errors", async () => {
    fake.state.rows = [{ id: "h1", repo: "acme/app", github_hook_id: 4 }];
    fake.state.ghResult = () => ghFail("gh: Not Found (HTTP 404)");
    await hooks.removeHook("/dev/app");
    expect(fake.state.rows).toEqual([]);
    fake.state.rows = [{ id: "h1", repo: "acme/app", github_hook_id: 4 }];
    fake.state.ghResult = () => ghFail("gh: Forbidden (HTTP 403)");
    await expect(hooks.removeHook("/dev/app")).rejects.toThrow("needs admin rights");
    expect(fake.state.rows).toHaveLength(1);
  });

  it("does nothing signed out or with no hook, and passes on a read error", async () => {
    fake.state.uid = null;
    await hooks.removeHook("/dev/app");
    fake.state.uid = "u1";
    await hooks.removeHook("/dev/app");
    expect(fake.state.gh).toEqual([]);
    fake.state.error = { message: "offline" };
    await expect(hooks.removeHook("/dev/app")).rejects.toThrow("offline");
  });
});

describe("listening", () => {
  it("syncs the folders on a repo once its burst of events settles", async () => {
    issues.issueSyncFolders.mockReturnValue(["/dev/app", "/dev/web", "/dev/app2"]);
    issues.issueSyncStatus.mockReturnValue({ "/dev/app2": { repo: "Acme/App" } });
    await hooks.addHook("/dev/app");
    vi.useFakeTimers();
    fake.state.onChange?.({ new: { repo: "acme/app" } });
    fake.state.onChange?.({ new: { repo: "acme/app" } });
    fake.state.onChange?.({ new: {} });
    await vi.advanceTimersByTimeAsync(hooks.SETTLE_MS);
    expect(issues.syncIssues.mock.calls).toEqual([["/dev/app"], ["/dev/app2"]]);
  });

  it("logs a failed sync and skips a folder whose repo it can't read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    issues.issueSyncFolders.mockReturnValue(["/dev/app", "/dev/gone"]);
    issues.repoOf.mockImplementation((folder: string) => (folder === "/dev/gone" ? Promise.reject(new Error("gone")) : Promise.resolve("acme/app")));
    issues.syncIssues.mockRejectedValueOnce(new Error("rate limited"));
    await hooks.syncRepo("acme/app");
    expect(issues.syncIssues).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("GitHub issues for /dev/app: rate limited");
    warn.mockRestore();
  });

  it("follows sign-in and sign-out once started", async () => {
    vi.useFakeTimers();
    fake.state.rows = [{ id: "h1", repo: "acme/app", github_hook_id: 1 }];
    hooks.startHookListener();
    hooks.startHookListener();
    fake.state.onAuth?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.state.channels).toBe(1);
    fake.state.uid = "u2";
    fake.state.onAuth?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.state.channels).toBe(2);
    expect(fake.state.removed).toBe(1);
    fake.state.uid = null;
    fake.state.onAuth?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.state.removed).toBe(2);
  });

  it("logs a refresh that can't read the hooks, and starts quietly with accounts off", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.state.error = { message: "offline" };
    await hooks.refreshHookListener();
    expect(warn).toHaveBeenCalledWith("GitHub webhooks: offline");
    warn.mockRestore();
    fake.state.throwClient = true;
    expect(() => hooks.startHookListener()).not.toThrow();
  });
});
