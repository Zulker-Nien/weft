import { describe, expect, it } from "vitest";
import { rankItems } from "./db-picker";

type Row = { id: string; name: string; team?: string; git?: string; createdAt: number };

const row = (over: Partial<Row>): Row => ({ id: "x", name: "x", createdAt: 0, ...over });

// The providers' score scale (lib/vercel-view.ts matchScore): 2 the row carries the folder's name,
// 1 a partial, 0 neither. DbSelect badges 2 and up "best fit".
const folder = { folder: "/home/dev/weft", repo: "fotovlo/weft" };
const score = (r: Row) => {
  const want = ["weft"];
  const got = r.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (want.includes(got)) return 2;
  return got && want.some((w) => got.includes(w) || w.includes(got)) ? 1 : 0;
};

describe("rankItems", () => {
  const items: Row[] = [row({ id: "old", name: "docs", createdAt: 1 }), row({ id: "new", name: "notes", createdAt: 9 }), row({ id: "weft", name: "Weft", createdAt: 2, team: "Side" })];

  it("returns nothing while the provider is still loading", () => {
    expect(rankItems<Row>({ items: null, folder, search: "", score: () => 0, keys: () => [] })).toEqual([]);
  });

  it("puts the best fit first, then by `newest`", () => {
    const rows = rankItems<Row>({ items, folder, search: "", score, keys: (r) => [r.name], newest: (r) => r.createdAt });
    expect(rows.map((r) => r.item.id)).toEqual(["weft", "new", "old"]);
  });

  it("keeps the provider's own order when there is no `newest`", () => {
    const rows = rankItems<Row>({ items, folder, search: "", score, keys: (r) => [r.name] });
    expect(rows.map((r) => r.item.id)).toEqual(["weft", "old", "new"]);
  });

  it("filters on the search box across every key, case-insensitively and trimmed", () => {
    const keys = (r: Row) => [r.name, r.team ?? ""];
    expect(rankItems<Row>({ items, folder, search: " SIDE ", score, keys }).map((r) => r.item.id)).toEqual(["weft"]);
    expect(rankItems<Row>({ items, folder, search: "weft", score, keys }).map((r) => r.item.id)).toEqual(["weft"]);
  });

  it("skips a nullish key instead of failing on it, matching the row by another column", () => {
    const withGit: Row[] = [row({ id: "a", name: "docs" }), row({ id: "b", name: "docs", git: "fotovlo/weft-docs" })];
    const rows = rankItems<Row>({ items: withGit, folder, search: "weft", score: () => 0, keys: (r) => [r.name, r.git ?? null] });
    expect(rows.map((r) => r.item.id)).toEqual(["b"]);
  });

  it("trims to `limit`", () => {
    const many = Array.from({ length: 100 }, (_, i) => row({ id: String(i), name: `p${i}` }));
    expect(rankItems<Row>({ items: many, folder, search: "", score: () => 0, keys: () => [], limit: 5 })).toHaveLength(5);
  });

  it("carries each row's score through, for the best-fit badge", () => {
    const rows = rankItems<Row>({ items, folder, search: "", score, keys: (r) => [r.name] });
    expect(rows.find((r) => r.item.id === "weft")?.score).toBe(2);
    expect(rows.find((r) => r.item.id === "old")?.score).toBe(0);
  });
});