// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { carriesFiles, dropSpotAt, handFiles, NEW_THREAD, onHandedFiles, sameSpot, takeFiles } from "./file-drop";

const file = (name: string) => new File(["x"], name);

describe("handFiles / takeFiles", () => {
  it("keeps files per target until taken, once", () => {
    const heard = vi.fn();
    const off = onHandedFiles(heard);
    handFiles("c1", [file("a.png")]);
    handFiles("c1", [file("b.pdf")]);
    handFiles(NEW_THREAD, [file("c.txt")]);
    expect(heard).toHaveBeenCalledTimes(3);
    expect(takeFiles("c1").map((f) => f.name)).toEqual(["a.png", "b.pdf"]);
    expect(takeFiles("c1")).toEqual([]);
    expect(takeFiles(NEW_THREAD).map((f) => f.name)).toEqual(["c.txt"]);
    off();
    handFiles("c2", [file("d")]);
    expect(heard).toHaveBeenCalledTimes(3);
    takeFiles("c2");
  });

  it("ignores an empty hand-off", () => {
    const heard = vi.fn();
    const off = onHandedFiles(heard);
    handFiles("c1", []);
    expect(heard).not.toHaveBeenCalled();
    off();
  });
});

describe("carriesFiles", () => {
  it("is true only for a drag with Files", () => {
    expect(carriesFiles({ types: ["Files"] } as unknown as DataTransfer)).toBe(true);
    expect(carriesFiles({ types: ["text/plain"] } as unknown as DataTransfer)).toBe(false);
    expect(carriesFiles(null)).toBe(false);
    expect(carriesFiles(undefined)).toBe(false);
  });
});

describe("dropSpotAt", () => {
  document.body.innerHTML = `
    <div class="composer"><p id="in-composer">x</p></div>
    <div data-card-id="c1"><span id="in-card">t</span></div>
    <div data-card-id=""><span id="blank-card">t</span></div>
    <aside data-drop-target="c2"><p id="in-thread">x</p></aside>
    <aside data-drop-target="new"><p id="in-dialog">x</p></aside>
    <main id="board">text</main>`;
  const at = (id: string) => document.getElementById(id);

  it("reads the spot from the DOM", () => {
    expect(dropSpotAt(at("in-composer")).kind).toBe("composer");
    expect(dropSpotAt(at("in-card"))).toMatchObject({ kind: "card", id: "c1" });
    expect(dropSpotAt(at("in-thread"))).toMatchObject({ kind: "thread", id: "c2" });
    expect(dropSpotAt(at("in-dialog"))).toEqual({ kind: "new" });
    expect(dropSpotAt(at("blank-card"))).toEqual({ kind: "new" });
    expect(dropSpotAt(at("board"))).toEqual({ kind: "new" });
  });

  it("climbs from a text node and treats nothing as new", () => {
    expect(dropSpotAt(at("in-card")!.firstChild)).toMatchObject({ kind: "card", id: "c1" });
    expect(dropSpotAt(null)).toEqual({ kind: "new" });
    expect(dropSpotAt(window)).toEqual({ kind: "new" });
  });
});

describe("sameSpot", () => {
  const el = document.createElement("div");
  it("compares kind and id", () => {
    expect(sameSpot(null, null)).toBe(true);
    expect(sameSpot(null, { kind: "new" })).toBe(false);
    expect(sameSpot({ kind: "new" }, { kind: "new" })).toBe(true);
    expect(sameSpot({ kind: "new" }, { kind: "composer" })).toBe(false);
    expect(sameSpot({ kind: "card", id: "a", el }, { kind: "card", id: "a", el })).toBe(true);
    expect(sameSpot({ kind: "card", id: "a", el }, { kind: "card", id: "b", el })).toBe(false);
  });
});
