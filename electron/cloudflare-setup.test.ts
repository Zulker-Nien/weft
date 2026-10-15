import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { narrowGroups } from "./cloudflare-api.cjs";
import { TOKEN_FILE } from "./cloudflare.cjs";
import { GROUPS, make, ok, setupApi } from "./cloudflare.harness";

// A pasted setup token ("Create additional tokens"): Weft makes its own narrow token and deletes the setup one.
describe("createCloudflare with a setup token", () => {
  it("makes its own narrow token with a setup token, keeps it, and deletes the setup token", async () => {
    const { routes, deleted } = setupApi((auth) => (auth === "narrow" ? ok([{ id: "acc1", name: "Acme" }]) : ok([])));
    const { cloudflare, dataDir, calls, sleep } = make(routes);
    const saved = await cloudflare.setToken("setup");
    expect(saved).toEqual({ name: "Acme", made: true, setupDeleted: true });
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url.pathname).toBe("/client/v4/user/tokens");
    expect(JSON.parse(post!.body!)).toEqual({
      name: "Weft on mac",
      policies: [{ effect: "allow", resources: { "com.cloudflare.api.account.*": "*" }, permission_groups: [{ id: "g-acct" }, { id: "g-workers" }, { id: "g-pages" }] }],
    });
    expect(deleted).toEqual(["s1"]);
    expect(calls.at(-1)).toMatchObject({ auth: "Bearer setup", method: "DELETE" });
    expect(sleep).not.toHaveBeenCalled();
    // The narrow token is the one kept: the drawer's next call uses it.
    expect(fs.readFileSync(path.join(dataDir, TOKEN_FILE), "utf8")).not.toContain("setup");
    await cloudflare.status([]);
    expect(calls.at(-1)?.auth).toBe("Bearer narrow");
  });

  it("waits for a new token to work, says when the setup token couldn't be deleted, and deletes a new token that never works", async () => {
    const slow = setupApi((_auth, tryNo) => (tryNo < 3 ? { status: 401, body: {} } : ok([{ id: "acc1", name: "Acme" }])), false);
    const made = make(slow.routes);
    expect(await made.cloudflare.setToken("setup")).toEqual({ name: "Acme", made: true, setupDeleted: false });
    expect(made.sleep).toHaveBeenCalledTimes(2);

    const never = setupApi(() => ok([]));
    const failed = make(never.routes);
    await expect(failed.cloudflare.setToken("setup")).rejects.toThrow("reaches no Cloudflare account");
    expect(never.deleted).toEqual(["n1"]);
    expect(fs.existsSync(path.join(failed.dataDir, TOKEN_FILE))).toBe(false);

    const stuck = setupApi(() => ok([]), false);
    await expect(make(stuck.routes).cloudflare.setToken("setup")).rejects.toThrow("reaches no Cloudflare account");
  });

  it("keeps a token that can't make tokens as it is", async () => {
    const { routes } = setupApi(() => ok([{ id: "acc1", name: "Acme" }]));
    const { cloudflare, calls } = make(routes);
    expect(await cloudflare.setToken("mine")).toEqual({ name: "Acme" });
    expect(calls.some((c) => c.method !== "GET")).toBe(false);
  });

  it("picks the narrow token's permission groups, and refuses when a needed one isn't offered", () => {
    expect(narrowGroups([...GROUPS, { id: "g-tail", name: "Workers Tail Read", scopes: ["com.cloudflare.api.account"] }])).toEqual([{ id: "g-acct" }, { id: "g-workers" }, { id: "g-pages" }, { id: "g-tail" }]);
    expect(() => narrowGroups(GROUPS.slice(1))).toThrow('doesn\'t offer "Account Settings Read"');
    expect(() => narrowGroups(null)).toThrow("Account Settings Read");
  });
});
