import { describe, expect, it } from "vitest";
import { buildSections, errorText, matches } from "./repo-picker";
import type { GithubRepo, LocalRepo } from "./types";

const repo = (name: string, extra: Partial<LocalRepo> = {}): LocalRepo => ({ name, path: `/dev/${name}`, ...extra }) as LocalRepo;
const gh = (fullName: string, extra: Partial<GithubRepo> = {}): GithubRepo => ({ fullName, ...extra }) as GithubRepo;

describe("matches", () => {
  it("accepts everything for an empty query", () => expect(matches("")).toBe(true));
  it("needs every word somewhere in the fields", () => {
    expect(matches("web app", "weft", undefined, "my web app")).toBe(true);
    expect(matches("web zzz", "weft", "my web app")).toBe(false);
  });
});

describe("errorText", () => {
  it("reads an Error's message or stringifies anything else", () => {
    expect(errorText(new Error("boom"))).toBe("boom");
    expect(errorText("plain")).toBe("plain");
  });
});

describe("buildSections", () => {
  it("is empty with nothing loaded", () => expect(buildSections("", null, null)).toEqual([]));

  it("splits recent from other local repos and caps an empty query", () => {
    const local = [repo("a", { recentAt: 1 }), repo("b"), ...Array.from({ length: 30 }, (_, i) => repo(`r${i}`))];
    const out = buildSections("", local, null);
    expect(out.map((s) => s.title)).toEqual(["Recent", "On this Mac"]);
    expect(out[1]!.choices).toHaveLength(25);
  });

  it("offers a typed path first and filters by query with larger caps", () => {
    const out = buildSections("~/x", [repo("x", { path: "~/x" })], null);
    expect(out[0]).toEqual({ title: "Folder", icon: "folder", choices: [{ kind: "path", path: "~/x" }] });
    expect(buildSections("r", Array.from({ length: 50 }, (_, i) => repo(`r${i}`)), null)[0]!.choices).toHaveLength(40);
    expect(buildSections("r", Array.from({ length: 30 }, (_, i) => repo(`r${i}`, { recentAt: 1 })), null)[0]!.choices).toHaveLength(20);
  });

  it("lists only GitHub repos that aren't cloned yet", () => {
    const out = buildSections("", null, [gh("o/new"), gh("o/cloned", { localPath: "/dev/cloned" })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.choices).toEqual([{ kind: "github", repo: gh("o/new") }]);
    expect(buildSections("zzz", null, [gh("o/new")])).toEqual([]);
    expect(buildSections("tool", null, [gh("o/new", { description: "a tool" })])).toHaveLength(1);
    expect(buildSections("o", [], Array.from({ length: 50 }, (_, i) => gh(`o/r${i}`)))[0]!.choices).toHaveLength(40);
    expect(buildSections("", [], Array.from({ length: 50 }, (_, i) => gh(`o/r${i}`)))[0]!.choices).toHaveLength(15);
  });
});
