import { describe, expect, it } from "vitest";
import { compareCardOrder, ORDER_STEP, ordersForSlot, type OrderedCard } from "./card-order";

const card = (id: string, order?: number, createdAt = 0): OrderedCard => ({ id, order, createdAt });

describe("compareCardOrder", () => {
  it("sorts by saved order and uses creation time to break ties", () => {
    expect([card("later", 20, 1), card("first", 10, 2), card("tie-later", 10, 3)].sort(compareCardOrder).map((c) => c.id))
      .toEqual(["first", "tie-later", "later"]);
  });

  it("falls back to creation time when an order is missing", () => {
    expect(compareCardOrder(card("old", undefined, 1), card("new", undefined, 2))).toBeLessThan(0);
  });
});

describe("ordersForSlot", () => {
  it("starts an empty column at one order step", () => {
    expect(ordersForSlot([], "moved", 0)).toEqual(new Map([["moved", ORDER_STEP]]));
  });

  it("leaves a full step before the first sibling", () => {
    expect(ordersForSlot([card("next", 200)], "moved", 0)).toEqual(new Map([["moved", 200 - ORDER_STEP]]));
  });

  it("leaves a full step after the last sibling", () => {
    expect(ordersForSlot([card("previous", 200)], "moved", 1)).toEqual(new Map([["moved", 200 + ORDER_STEP]]));
  });

  it("splits an open integer gap", () => {
    expect(ordersForSlot([card("previous", 100), card("next", 105)], "moved", 1))
      .toEqual(new Map([["moved", 102]]));
  });

  it("renumbers all cards in the requested slot when the gap is closed", () => {
    expect(ordersForSlot([card("a", 100), card("b", 101)], "moved", 1)).toEqual(
      new Map([["a", ORDER_STEP], ["moved", 2 * ORDER_STEP], ["b", 3 * ORDER_STEP]]),
    );
  });
});
