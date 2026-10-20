// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSavedOrg, saveOrg, stillListed, TEAM_ORG_KEY, unlinkedRepos } from "./team-view";

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

describe("unlinkedRepos", () => {
  it("drops linked repos (any case) and duplicates, sorted", () => {
    expect(unlinkedRepos(["b/b", "a/a", "a/a", "C/c"], ["B/B"])).toEqual(["C/c", "a/a"]);
  });
});
