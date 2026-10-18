// lib/signed-in-client.ts: the Weft account's Supabase client for the Mac's background posts.
// safeClient wraps accountClient() in a try/catch (returns null on a build without accounts);
// signedIn asks the client for a session.
import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("./account", () => ({ accountClient: account.client }));

const { safeClient, signedIn } = await import("./signed-in-client");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("safeClient", () => {
  it("returns the client when accountClient() succeeds", () => {
    const fake = { rpc: vi.fn() };
    account.client.mockReturnValue(fake);
    expect(safeClient()).toBe(fake);
  });

  it("returns null when accountClient() throws (a build without accounts)", () => {
    account.client.mockImplementation(() => {
      throw new Error("Weft accounts aren't set up in this build yet.");
    });
    expect(safeClient()).toBeNull();
  });
});

describe("signedIn", () => {
  it("returns true when the client has a session", async () => {
    const client = { auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "u1" } } } }) } } as never;
    expect(await signedIn(client)).toBe(true);
  });

  it("returns false when the client has no session", async () => {
    const client = { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } } as never;
    expect(await signedIn(client)).toBe(false);
  });
});