import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { authorizeUrl, pkce, signIn, startLoopback } from "./blastcp-oauth.cjs";
import { createBlastcp, LINKS_FILE, parseWorkspaces, postOf, registerBlastcp, TOKEN_FILE } from "./blastcp.cjs";

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "blastcp-"));

const GET_STARTED = `BlastCP is a posting queue.

Workspaces:
- Alex Miller (alex): 3 connected channels; properties (pass one as property_slug): alex = Alex Miller, weft = Weft, a-b = A = B, x = Y
- Side (Co) (side): 0 connected channels; no properties yet
- broken line

Where channels are connected, call list_channels.`;

const text = (t: string, isError = false) => ({ result: { content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) } });

// A fake blastcp.com/api/mcp: answers tools/call by tool name. Records each call and its token.
function fakeMcp(tools: Record<string, unknown>) {
  const calls: { tool: string; args: Record<string, unknown>; auth: string }[] = [];
  const fetch = vi.fn((url: string, init: { headers: Record<string, string>; body: string }) => {
    const { params } = JSON.parse(init.body) as { params: { name: string; arguments: Record<string, unknown> } };
    calls.push({ tool: params.name, args: params.arguments, auth: init.headers.Authorization ?? "" });
    const answer = tools[params.name];
    const res: unknown = typeof answer === "function" ? (answer as (args: Record<string, unknown>) => unknown)(params.arguments) : answer;
    const { status = 200, body = res } = (res && typeof res === "object" && "status" in res ? res : { body: res }) as { status?: number; body?: unknown };
    return Promise.resolve({ ok: status < 400, status, json: () => (body === "bad json" ? Promise.reject(new Error("x")) : Promise.resolve(body)) });
  });
  return { fetch, calls };
}

const WHOAMI = text(JSON.stringify({ email: "me@x.com", workspaces: [] }));

function signedIn(dir: string, token = "tok", expiresAt: number | null = 123) {
  fs.writeFileSync(path.join(dir, TOKEN_FILE), JSON.stringify({ token: safeStorage.encryptString(token).toString("base64"), expiresAt }));
}

describe("parseWorkspaces", () => {
  it("reads each workspace and its properties from get_started", () => {
    expect(parseWorkspaces(GET_STARTED)).toEqual([
      {
        slug: "alex",
        name: "Alex Miller",
        properties: [
          { slug: "alex", name: "Alex Miller" },
          { slug: "weft", name: "Weft" },
          { slug: "a-b", name: "A = B" },
          { slug: "x", name: "Y" },
        ],
      },
      { slug: "side", name: "Side (Co)", properties: [] },
    ]);
    expect(parseWorkspaces("- W (w): properties (pass one as property_slug): s = ")).toEqual([{ slug: "w", name: "W", properties: [{ slug: "s", name: "s" }] }]);
    expect(parseWorkspaces(" = x")).toEqual([]);
    expect(parseWorkspaces("- W (w): properties (pass one as property_slug): Not A Slug")).toEqual([{ slug: "w", name: "W", properties: [] }]);
  });
});

describe("postOf", () => {
  it("turns a list_posts row into the board's shape", () => {
    expect(
      postOf({ id: 7, platform: "linkedin", status: "scheduled", title: "", link_title: "Card", scheduled_for: "2026-10-12T00:00:00Z", published_at: "2026-10-11T00:00:00Z", external_url: "https://in/x", review_url: "https://b/p" }),
    ).toEqual({ id: "7", platform: "linkedin", status: "scheduled", title: "Card", scheduledFor: Date.UTC(2026, 9, 12), publishedAt: Date.UTC(2026, 9, 11), url: "https://in/x", reviewUrl: "https://b/p" });
    expect(postOf({ id: "a", link_url: "https://l" })).toEqual({ id: "a", platform: "", status: "", title: "https://l", scheduledFor: null, publishedAt: null, url: null, reviewUrl: null });
    expect(postOf({ id: "b" }).title).toBeNull();
  });
});

describe("createBlastcp", () => {
  it("is signed out with no token, and lists links without asking BlastCP", async () => {
    const dir = tmp();
    const { fetch } = fakeMcp({});
    const blastcp = createBlastcp({ dataDir: dir, safeStorage, fetch });
    blastcp.link("/dev/weft", "alex", "weft", "Weft");
    expect(await blastcp.status(["/dev/weft", "/dev/other"])).toEqual({
      signedIn: false,
      user: null,
      expiresAt: null,
      error: null,
      folders: [
        { folder: "/dev/weft", link: { org: "alex", property: "weft", name: "Weft", url: "https://blastcp.com/alex/property/weft" }, posts: null, error: null },
        { folder: "/dev/other", link: null, posts: null, error: null },
      ],
    });
    expect(fetch).not.toHaveBeenCalled();
    await expect(blastcp.workspaces()).rejects.toThrow("Connect BlastCP first.");
  });

  it("reads each linked folder's posts with the saved token", async () => {
    const dir = tmp();
    signedIn(dir);
    const { fetch, calls } = fakeMcp({
      whoami: WHOAMI,
      list_posts: (args: { property_slug: string }) =>
        args.property_slug === "weft"
          ? text(JSON.stringify({ posts: [{ id: "p1", platform: "threads", status: "draft", title: "Hello" }] }))
          : args.property_slug === "empty"
            ? text('No posts yet in "alex/empty". Call create_post to draft one.')
            : args.property_slug === "odd"
              ? text(JSON.stringify({ posts: "nope" }))
              : text("No property", true),
    });
    const blastcp = createBlastcp({ dataDir: dir, safeStorage, fetch });
    blastcp.link("/a", "alex", "weft", "");
    blastcp.link("/b", "alex", "empty", "Empty");
    blastcp.link("/c", "alex", "gone", "Gone");
    blastcp.link("/d", "alex", "odd", "Odd");
    const s = await blastcp.status(["/a", "/b", "/c", "/d"]);
    expect(s).toMatchObject({ signedIn: true, user: { email: "me@x.com" }, expiresAt: 123, error: null });
    expect(s.folders.map((f: { posts: unknown; error: unknown }) => [f.posts, f.error])).toEqual([
      [[{ id: "p1", platform: "threads", status: "draft", title: "Hello", scheduledFor: null, publishedAt: null, url: null, reviewUrl: null }], null],
      [[], null],
      [null, "No property"],
      [[], null],
    ]);
    expect(s.folders[0]?.link?.name).toBe("weft");
    expect(calls[0]?.auth).toBe("Bearer tok");
    expect(calls.find((c) => c.tool === "list_posts")?.args).toEqual({ org_slug: "alex", property_slug: "weft", limit: 100 });
  });

  it("reports a refused token, a server error and a JSON-RPC error", async () => {
    const dir = tmp();
    signedIn(dir, "tok", null);
    const refused = createBlastcp({ dataDir: dir, safeStorage, fetch: fakeMcp({ whoami: { status: 401, body: {} } }).fetch });
    expect(await refused.status([])).toMatchObject({ signedIn: true, user: null, expiresAt: null, error: "BlastCP's sign-in ran out. Connect again." });
    const down = createBlastcp({ dataDir: dir, safeStorage, fetch: fakeMcp({ get_started: { status: 500, body: "bad json" } }).fetch });
    await expect(down.workspaces()).rejects.toThrow("BlastCP answered 500.");
    const rpc = createBlastcp({ dataDir: dir, safeStorage, fetch: fakeMcp({ get_started: { error: { message: "Unknown tool" } } }).fetch });
    await expect(rpc.workspaces()).rejects.toThrow("Unknown tool");
    const blank = createBlastcp({ dataDir: dir, safeStorage, fetch: fakeMcp({ get_started: { result: { isError: true } } }).fetch });
    await expect(blank.workspaces()).rejects.toThrow("BlastCP couldn't do that.");
  });

  it("lists workspaces from get_started", async () => {
    const dir = tmp();
    signedIn(dir);
    const blastcp = createBlastcp({ dataDir: dir, safeStorage, fetch: fakeMcp({ get_started: text(GET_STARTED) }).fetch });
    expect((await blastcp.workspaces()).map((w: { slug: string }) => w.slug)).toEqual(["alex", "side"]);
  });

  it("connects once at a time, keeps the token sealed, and forgets it", async () => {
    const dir = path.join(tmp(), "new");
    type Login = { token: string; expiresAt: number | null; clientId: string };
    let finish: (v: Login) => void = () => {};
    const login = vi.fn(() => new Promise<Login>((ok) => (finish = ok)));
    const { fetch, calls } = fakeMcp({ whoami: text(JSON.stringify({})) });
    const blastcp = createBlastcp({ dataDir: dir, safeStorage, fetch, openExternal: vi.fn(), login });
    const first = blastcp.connect();
    expect(blastcp.connect()).toBe(first);
    finish({ token: "fresh", expiresAt: 99, clientId: "mcp_1" });
    expect(await first).toEqual({ email: "you" });
    expect(login).toHaveBeenCalledTimes(1);
    expect(calls[0]?.auth).toBe("Bearer fresh");
    const saved = JSON.parse(fs.readFileSync(path.join(dir, TOKEN_FILE), "utf8")) as { token: string; expiresAt: number; clientId: string };
    expect(saved).toMatchObject({ expiresAt: 99, clientId: "mcp_1" });
    expect(saved.token).not.toContain("fresh");
    expect(fs.statSync(path.join(dir, TOKEN_FILE)).mode & 0o777).toBe(0o600);
    expect(blastcp.forget()).toEqual({ signedIn: false });
    expect(fs.existsSync(path.join(dir, TOKEN_FILE))).toBe(false);
  });

  it("won't connect without the Keychain, and a failed connect can be tried again", async () => {
    const dir = tmp();
    const locked = createBlastcp({ dataDir: dir, safeStorage: { ...safeStorage, isEncryptionAvailable: () => false }, fetch: vi.fn(), login: vi.fn() });
    await expect(locked.connect()).rejects.toThrow("Keychain");
    const login = vi.fn().mockRejectedValueOnce(new Error("You turned BlastCP down in the browser.")).mockResolvedValueOnce({ token: "t", expiresAt: null, clientId: "c" });
    const blastcp = createBlastcp({ dataDir: dir, safeStorage, fetch: fakeMcp({ whoami: WHOAMI }).fetch, login });
    await expect(blastcp.connect()).rejects.toThrow("turned BlastCP down");
    expect(await blastcp.connect()).toEqual({ email: "me@x.com" });
  });

  it("links and unlinks folders in the data folder, and wants an absolute path", () => {
    const dir = tmp();
    const blastcp = createBlastcp({ dataDir: dir, safeStorage, fetch: vi.fn() });
    expect(blastcp.link("/a", "o", "p", "Pretty")).toEqual({ linked: true, name: "Pretty" });
    blastcp.link("/b", "o", "q", "");
    expect(JSON.parse(fs.readFileSync(path.join(dir, LINKS_FILE), "utf8"))).toEqual({ "/a": { org: "o", property: "p", name: "Pretty" }, "/b": { org: "o", property: "q", name: "q" } });
    expect(blastcp.unlink("/a")).toEqual({ linked: false });
    expect(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, LINKS_FILE), "utf8")) as object)).toEqual(["/b"]);
    expect(() => blastcp.link("relative", "o", "p", "")).toThrow("Pick a project folder first.");
  });
});

describe("registerBlastcp", () => {
  it("answers the board window only, and cleans what it's given", async () => {
    const handlers: Record<string, (event: { sender: unknown }, ...args: unknown[]) => Promise<unknown>> = {};
    const ipcMain = { handle: (ch: string, fn: (typeof handlers)[string]) => (handlers[ch] = fn) };
    const board = {};
    const blastcp = { status: vi.fn(), connect: vi.fn(), forget: vi.fn(), workspaces: vi.fn(), link: vi.fn(), unlink: vi.fn() };
    registerBlastcp(ipcMain, { blastcp, isBoard: (s: unknown) => s === board });
    await expect(handlers["blastcp:status"]!({ sender: {} }, [])).rejects.toThrow("board window");
    const ev = { sender: board };
    await handlers["blastcp:status"]!(ev, ["/a", 3]);
    await handlers["blastcp:status"]!(ev, "nope");
    expect(blastcp.status.mock.calls).toEqual([[["/a"]], [[]]]);
    await handlers["blastcp:connect"]!(ev);
    await handlers["blastcp:forget"]!(ev);
    await handlers["blastcp:workspaces"]!(ev);
    await handlers["blastcp:link"]!(ev, "/a", "o", "p", undefined);
    await handlers["blastcp:unlink"]!(ev, "/a");
    expect(blastcp.link).toHaveBeenCalledWith("/a", "o", "p", "");
    expect(blastcp.unlink).toHaveBeenCalledWith("/a");
    expect([blastcp.connect, blastcp.forget, blastcp.workspaces].every((f) => f.mock.calls.length === 1)).toBe(true);
  });
});

describe("blastcp-oauth", () => {
  it("makes an S256 challenge from its verifier", () => {
    const { verifier, challenge, state } = pkce();
    expect(challenge).toBe(crypto.createHash("sha256").update(verifier).digest("base64url"));
    expect(state).toMatch(/^[\w-]{20,}$/);
  });

  it("builds the authorize address", () => {
    const url = new URL(authorizeUrl({ clientId: "c", redirectUri: "http://127.0.0.1:5/callback", challenge: "ch", state: "st" }));
    expect(url.origin + url.pathname).toBe("https://blastcp.com/api/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "c", code_challenge: "ch", code_challenge_method: "S256", state: "st", scope: "blastcp:all", response_type: "code" });
  });

  it("catches the code on the loopback server, and a refusal", async () => {
    const ok = await startLoopback();
    expect(ok.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect((await fetch(ok.redirectUri.replace("/callback", "/favicon.ico"))).status).toBe(404);
    const page = await fetch(`${ok.redirectUri}?code=abc&state=xyz`);
    expect(await page.text()).toContain("Connected to BlastCP");
    expect(await ok.result).toEqual({ code: "abc", state: "xyz" });
    ok.close();

    const no = await startLoopback();
    await fetch(`${no.redirectUri}?error=access_denied`);
    await expect(no.result).rejects.toThrow("You turned BlastCP down");
    no.close();

    const odd = await startLoopback();
    await fetch(odd.redirectUri);
    await expect(odd.result).rejects.toThrow("BlastCP answered with no code.");
    odd.close();

    const other = await startLoopback();
    await fetch(`${other.redirectUri}?error=server_error`);
    await expect(other.result).rejects.toThrow("BlastCP answered server_error.");
    other.close();
  });

  it("times out when you never finish in the browser", async () => {
    const slow = await startLoopback({ waitMs: 5 });
    await expect(slow.result).rejects.toThrow("timed out");
    slow.close();
  });

  type Answer = { status: number; body: unknown };
  function oauthFetch({ register = { status: 201, body: { client_id: "mcp_1" } }, token = { status: 200, body: { access_token: "tok", expires_in: 60 } } }: { register?: Answer; token?: Answer } = {}) {
    const calls: { url: string; body: string }[] = [];
    const fetch = vi.fn((url: string, init: { body: string }) => {
      calls.push({ url, body: init.body });
      const r = url.endsWith("/register") ? register : token;
      return Promise.resolve({ ok: r.status < 400, status: r.status, json: () => (r.body === null ? Promise.reject(new Error("x")) : Promise.resolve(r.body)) });
    });
    return { fetch, calls };
  }

  const loopbackWith = (back: (state: string) => { code: string; state: string | null }) => {
    const close = vi.fn();
    type Back = { code: string; state: string | null };
    let opened: (v: Back) => void = () => {};
    const result = new Promise<Back>((ok) => (opened = ok));
    // The browser "redirects back" once Weft opens it, with the state it was sent.
    const openExternal = (url: string) => opened(back(new URL(url).searchParams.get("state") ?? ""));
    const loopback = () => Promise.resolve({ redirectUri: "http://127.0.0.1:9/callback", result, close });
    return { loopback, openExternal, close };
  };

  it("signs in: registers, opens the browser, swaps the code for a token", async () => {
    const { fetch, calls } = oauthFetch();
    const { loopback, openExternal, close } = loopbackWith((state) => ({ code: "c0de", state }));
    const before = Date.now();
    const result = await signIn({ fetch, openExternal, loopback });
    expect(result).toMatchObject({ token: "tok", clientId: "mcp_1" });
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(JSON.parse(calls[0]!.body)).toEqual({ client_name: "Weft", redirect_uris: ["http://127.0.0.1:9/callback"] });
    expect(Object.fromEntries(new URLSearchParams(calls[1]!.body))).toMatchObject({ grant_type: "authorization_code", code: "c0de", client_id: "mcp_1", redirect_uri: "http://127.0.0.1:9/callback" });
    expect(close).toHaveBeenCalled();
    const noExpiry = await signIn({ fetch: oauthFetch({ token: { status: 200, body: { access_token: "t" } } }).fetch, ...loopbackWith((state) => ({ code: "c", state })) });
    expect(noExpiry.expiresAt).toBeNull();
  });

  it("stops on a refused registration, a mismatched state or a refused token", async () => {
    const ok = () => loopbackWith((state) => ({ code: "c", state }));
    await expect(signIn({ fetch: oauthFetch({ register: { status: 400, body: { error_description: "Invalid redirect_uri" } } }).fetch, ...ok() })).rejects.toThrow("Invalid redirect_uri");
    await expect(signIn({ fetch: oauthFetch({ register: { status: 500, body: null } }).fetch, ...ok() })).rejects.toThrow("wouldn't register Weft (500)");
    const forged = loopbackWith(() => ({ code: "c", state: "other" }));
    await expect(signIn({ fetch: oauthFetch().fetch, ...forged })).rejects.toThrow("didn't match");
    expect(forged.close).toHaveBeenCalled();
    await expect(signIn({ fetch: oauthFetch({ token: { status: 400, body: { error_description: "PKCE verification failed" } } }).fetch, ...ok() })).rejects.toThrow("PKCE");
    await expect(signIn({ fetch: oauthFetch({ token: { status: 502, body: null } }).fetch, ...ok() })).rejects.toThrow("wouldn't give Weft a token (502)");
  });
});
