// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NEW_THREAD, takeFiles } from "@/lib/file-drop";
import type { Card } from "@/lib/types";
import FileDrop, { hintFor } from "./FileDrop";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const cards = [{ id: "c1", title: "Fix login" }] as Card[];

function fire(type: string, target: Element, files: File[] = []) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files, dropEffect: "none" } });
  act(() => {
    target.dispatchEvent(event);
  });
}

function setup(newOpen = false) {
  const onOpenCard = vi.fn();
  const onOpenNew = vi.fn();
  render(
    <>
      <div data-card-id="c1">card</div>
      <div data-card-id="gone">stale card</div>
      <aside data-drop-target="c9">thread</aside>
      <main>board</main>
      <FileDrop cards={cards} newOpen={newOpen} onOpenCard={onOpenCard} onOpenNew={onOpenNew} />
    </>,
  );
  return { onOpenCard, onOpenNew };
}

const png = () => new File(["x"], "shot.png");

describe("FileDrop", () => {
  it("names the card under the cursor", () => {
    setup();
    fire("dragover", screen.getByText("card"));
    expect(screen.getByText("Drop to attach to “Fix login”")).toBeTruthy();
  });

  it("opens a card with the files waiting for its reply box", () => {
    const { onOpenCard } = setup();
    fire("drop", screen.getByText("card"), [png()]);
    expect(onOpenCard).toHaveBeenCalledWith(cards[0]);
    expect(takeFiles("c1").map((f) => f.name)).toEqual(["shot.png"]);
  });

  it("drops nothing on a card that's gone", () => {
    const { onOpenCard } = setup();
    fire("drop", screen.getByText("stale card"), [png()]);
    expect(onOpenCard).not.toHaveBeenCalled();
    expect(takeFiles("gone")).toEqual([]);
  });

  it("hands files to an open thread", () => {
    const { onOpenCard, onOpenNew } = setup();
    fire("drop", screen.getByText("thread"), [png()]);
    expect(takeFiles("c9")).toHaveLength(1);
    expect(onOpenCard).not.toHaveBeenCalled();
    expect(onOpenNew).not.toHaveBeenCalled();
  });

  it("starts a new thread from empty board, or adds to the open dialog", () => {
    const { onOpenNew } = setup();
    fire("drop", screen.getByText("board"), [png()]);
    expect(onOpenNew).toHaveBeenCalledOnce();
    expect(takeFiles(NEW_THREAD)).toHaveLength(1);
    cleanup();
    const open = setup(true);
    fire("drop", screen.getByText("board"), [png()]);
    expect(open.onOpenNew).not.toHaveBeenCalled();
    expect(takeFiles(NEW_THREAD)).toHaveLength(1);
  });
});

describe("hintFor", () => {
  const el = document.createElement("div");
  it("says where the files will go", () => {
    expect(hintFor({ kind: "card", id: "c1", el }, cards)).toBe("Drop to attach to “Fix login”");
    expect(hintFor({ kind: "card", id: "x", el }, cards)).toBe("Drop to attach to this thread");
    expect(hintFor({ kind: "thread", id: "c9", el }, cards)).toBe("Drop to attach to this thread");
    expect(hintFor({ kind: "new" }, cards)).toBe("Drop to start a new thread with these files");
  });
});
