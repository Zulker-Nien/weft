// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { orgLabel, readSavedOrg, saveOrg, stillListed, TEAM_ORG_KEY, unlinkedRepos } from "./team-view";

const labels = { owner: "Owner", admin: "Admin", member: "Member" };

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("saved workspace", () => {
  it("round-trips and clears", () => {
    expect(readSavedOrg()).toBeUndefined();
    saveOrg("acme");
    expect(window.localStorage.getItem(TEAM_ORG_KEY)).toBe("acme");
    expect(readSavedOrg()).toBe("acme");
    saveOrg(undefined);
    expect(readSavedOrg()).toBeUndefined();
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readSavedOrg()).toBeUndefined();
    expect(() => saveOrg("acme")).not.toThrow();
  });
});

describe("stillListed", () => {
  const orgs = [{ id: "1", slug: "acme", name: "Acme" }];
  it("accepts no pick or a listed slug, refuses a gone one", () => {
    expect(stillListed(undefined, orgs)).toBe(true);
    expect(stillListed("acme", orgs)).toBe(true);
    expect(stillListed("gone", orgs)).toBe(false);
  });
});

describe("orgLabel", () => {
  it("adds the role when known", () => {
    expect(orgLabel({ id: "1", slug: "a", name: "Acme", role: "admin" }, labels)).toBe("Acme · Admin");
    expect(orgLabel({ id: "1", slug: "a", name: "Acme" }, labels)).toBe("Acme");
  });
});

describe("unlinkedRepos", () => {
  it("drops linked repos (any case) and duplicates, sorted", () => {
    expect(unlinkedRepos(["b/b", "a/a", "a/a", "C/c"], ["B/B"])).toEqual(["C/c", "a/a"]);
  });
});
