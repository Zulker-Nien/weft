import { describe, expect, it } from "vitest";
import { pageFromRows, pageUpdateFor } from "./cloud-thread-page";
import type { ThreadItem } from "./types";

const item = (text: string): ThreadItem => ({ kind: "assistant", text, at: 1 });
const row = (seq: number, text = `m${seq}`, card_id = "c1") => ({ card_id, seq, item: item(text) });
const texts = (items: ThreadItem[]) => items.map((i) => (i as { text: string }).text);

describe("pageFromRows", () => {
  it("orders a newest-first page oldest first, starting at its lowest seq", () => {
    const page = pageFromRows("c1", [row(12), row(11), row(10)]);
    expect(texts(page.items)).toEqual(["m10", "m11", "m12"]);
    expect(page).toMatchObject({ start: 10, total: 13 });
  });

  it("leaves out another card's rows and an item that didn't arrive whole", () => {
    const page = pageFromRows("c1", [row(1), row(2, "x", "c2"), { card_id: "c1", seq: 3, item: "broken" as unknown as ThreadItem }]);
    expect(texts(page.items)).toEqual(["m1"]);
  });

  it("is an empty page when nothing has synced", () => {
    expect(pageFromRows("c1", [])).toEqual({ items: [], start: 0, total: 0 });
  });
});

describe("pageUpdateFor", () => {
  const page = pageFromRows("c1", [row(10), row(11), row(12)]);

  it("adds a new item at its index and replaces an updated one", () => {
    const added = pageUpdateFor("c1", { eventType: "INSERT", new: row(13) })!(page);
    expect(texts(added.items)).toEqual(["m10", "m11", "m12", "m13"]);
    const updated = pageUpdateFor("c1", { eventType: "UPDATE", new: row(11, "edited") })!(added);
    expect(texts(updated.items)).toEqual(["m10", "edited", "m12", "m13"]);
  });

  it("cuts the window at a deleted seq, and drops it all when the cut is above it", () => {
    expect(texts(pageUpdateFor("c1", { eventType: "DELETE", old: { card_id: "c1", seq: 11 } })!(page).items)).toEqual(["m10"]);
    expect(pageUpdateFor("c1", { eventType: "DELETE", old: { card_id: "c1", seq: 4 } })!(page)).toEqual({ items: [], start: 4, total: 4 });
    expect(pageUpdateFor("c1", { eventType: "DELETE", old: { card_id: "c1", seq: 20 } })!(page)).toBe(page);
  });

  it("ignores another card's changes and rows that aren't whole", () => {
    expect(pageUpdateFor("c1", { eventType: "INSERT", new: row(13, "x", "c2") })).toBeNull();
    expect(pageUpdateFor("c1", { eventType: "DELETE", old: { card_id: "c2", seq: 1 } })).toBeNull();
    expect(pageUpdateFor("c1", { eventType: "DELETE", old: { card_id: "c1" } })).toBeNull();
    expect(pageUpdateFor("c1", { eventType: "INSERT", new: { card_id: "c1", seq: 3 } })).toBeNull();
    expect(pageUpdateFor("c1", { eventType: "UPDATE", new: { card_id: "c1", item: item("x") } })).toBeNull();
    expect(pageUpdateFor("c1", { eventType: "INSERT", new: null })).toBeNull();
  });
});
