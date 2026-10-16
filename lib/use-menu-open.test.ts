// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMenuOpen } from "./use-menu-open";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useMenuOpen", () => {
  it("reports open while the menu is up and closed when it goes down", () => {
    const changes: boolean[] = [];
    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => {
        const ref = useRef<HTMLDivElement>(null);
        useMenuOpen({ open, setOpen: () => {}, onOpenChange: (o) => changes.push(o), menuRef: ref });
        return null;
      },
      { initialProps: { open: true } },
    );
    expect(changes).toEqual([true]);
    rerender({ open: false });
    expect(changes).toEqual([true, false]);
  });

  it("does nothing when the menu starts closed", () => {
    const changes: boolean[] = [];
    renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      useMenuOpen({ open: false, setOpen: () => {}, onOpenChange: (o) => changes.push(o), menuRef: ref });
      return null;
    });
    expect(changes).toEqual([]);
  });

  it("closes the menu on an outside mousedown", () => {
    const setOpen = vi.fn();
    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      useMenuOpen({ open: true, setOpen, menuRef: ref });
      return ref;
    });
    (result.current as { current: HTMLDivElement | null }).current = document.createElement("div");
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    act(() => {
      outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it("does not close on a mousedown inside the menu", () => {
    const setOpen = vi.fn();
    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      useMenuOpen({ open: true, setOpen, menuRef: ref });
      return ref;
    });
    const el = document.createElement("div");
    (result.current as { current: HTMLDivElement | null }).current = el;
    const inside = document.createElement("span");
    el.appendChild(inside);
    document.body.appendChild(el);
    act(() => {
      inside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(setOpen).not.toHaveBeenCalled();
  });
});