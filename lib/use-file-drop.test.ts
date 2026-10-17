// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handFiles } from "./file-drop";
import { useFileDrop, useHandedFiles } from "./use-file-drop";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

// A drag event carrying files (or not) aimed at target.
function fire(type: string, target: EventTarget, { files = [] as File[], types = ["Files"] } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types, files, dropEffect: "none" } });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function setup() {
  document.body.innerHTML = `
    <div class="composer"><p id="composer">x</p></div>
    <div data-card-id="c1"><span id="card">t</span></div>
    <main id="board"></main>`;
  const onDrop = vi.fn();
  const hook = renderHook(() => useFileDrop(onDrop));
  const el = (id: string) => document.getElementById(id)!;
  return { onDrop, hook, el };
}

describe("useFileDrop", () => {
  it("shows the spot under the cursor and outlines a card", () => {
    const { hook, el } = setup();
    fire("dragenter", el("card"));
    const over = fire("dragover", el("card"));
    expect(over.defaultPrevented).toBe(true);
    expect(hook.result.current).toMatchObject({ kind: "card", id: "c1" });
    expect(document.querySelector("[data-card-id]")!.hasAttribute("data-file-over")).toBe(true);
    fire("dragover", el("card"));
    fire("dragover", el("board"));
    expect(hook.result.current).toEqual({ kind: "new" });
    expect(document.querySelector("[data-card-id]")!.hasAttribute("data-file-over")).toBe(false);
  });

  it("hides the hint over a composer and leaves its drop to it", () => {
    const { hook, el, onDrop } = setup();
    fire("dragover", el("composer"));
    expect(hook.result.current).toBeNull();
    const drop = fire("drop", el("composer"), { files: [new File(["x"], "a.png")] });
    expect(drop.defaultPrevented).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("routes a drop with files and clears the hint", () => {
    const { hook, el, onDrop } = setup();
    const files = [new File(["x"], "a.png")];
    fire("dragover", el("card"));
    const drop = fire("drop", el("card"), { files });
    expect(drop.defaultPrevented).toBe(true);
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ kind: "card", id: "c1" }), files);
    expect(hook.result.current).toBeNull();
    fire("drop", el("board"));
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("clears when the drag leaves the window or ends", () => {
    const { hook, el } = setup();
    fire("dragenter", el("board"));
    fire("dragenter", el("card"));
    fire("dragover", el("card"));
    fire("dragleave", el("board"));
    expect(hook.result.current).not.toBeNull();
    fire("dragleave", el("card"));
    fire("dragleave", el("card"));
    expect(hook.result.current).toBeNull();
    fire("dragover", el("board"));
    fire("dragend", el("board"));
    expect(hook.result.current).toBeNull();
  });

  it("ignores drags that carry no files, like a card between columns", () => {
    const { hook, el, onDrop } = setup();
    for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
      const e = fire(type, el("card"), { types: ["text/plain"] });
      expect(e.defaultPrevented).toBe(false);
    }
    expect(hook.result.current).toBeNull();
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("stops listening on unmount", () => {
    const { hook, el, onDrop } = setup();
    hook.unmount();
    const e = fire("drop", el("board"), { files: [new File(["x"], "a")] });
    expect(e.defaultPrevented).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });
});

describe("useHandedFiles", () => {
  it("takes files already waiting, then each new hand-off", () => {
    const insert = vi.fn<(files: File[]) => void>();
    const names = (call: number) => (insert.mock.calls[call]?.[0] ?? []).map((f) => f.name);
    handFiles("t1", [new File(["x"], "early.png")]);
    const hook = renderHook(({ target }) => useHandedFiles(target, insert), { initialProps: { target: undefined as string | undefined } });
    expect(insert).not.toHaveBeenCalled();
    hook.rerender({ target: "t1" });
    expect(names(0)).toEqual(["early.png"]);
    act(() => handFiles("t1", [new File(["x"], "late.pdf")]));
    expect(names(1)).toEqual(["late.pdf"]);
    act(() => handFiles("other", [new File(["x"], "no")]));
    expect(insert).toHaveBeenCalledTimes(2);
    hook.unmount();
  });
});
