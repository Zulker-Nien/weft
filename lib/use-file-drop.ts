"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { carriesFiles, dropSpotAt, onHandedFiles, sameSpot, takeFiles, type DropSpot } from "./file-drop";

// Files dragged in from Finder, anywhere in the window. A composer takes its own drop (right where
// the cursor is); everywhere else the window catches it, says where it will go (`spot`, for the hint
// and the card's outline) and calls onDrop. Without this, a file let go outside a composer makes
// Electron navigate the whole board to file://.
export function useFileDrop(onDrop: (spot: DropSpot, files: File[]) => void) {
  const [spot, setSpot] = useState<DropSpot | null>(null);
  const drop = useEffectEvent(onDrop);

  useEffect(() => {
    // dragenter/leave fire for every child crossed; count them to know when the drag left the window.
    let depth = 0;
    const show = (next: DropSpot | null) => setSpot((prev) => (sameSpot(prev, next) ? prev : next));
    const enter = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      depth++;
    };
    const over = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      const next = dropSpotAt(e.target);
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      show(next.kind === "composer" ? null : next);
    };
    const leave = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) show(null);
    };
    const land = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      depth = 0;
      show(null);
      // The composer's editor already took it (and called preventDefault itself).
      const at = dropSpotAt(e.target);
      if (at.kind === "composer") return;
      e.preventDefault();
      const files = [...(e.dataTransfer as DataTransfer).files];
      if (files.length) drop(at, files);
    };
    const end = () => {
      depth = 0;
      show(null);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", land);
    window.addEventListener("dragend", end);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", land);
      window.removeEventListener("dragend", end);
    };
  }, []);

  // The card or thread under the cursor wears an outline while files hover it.
  useEffect(() => {
    if (!spot || !("el" in spot)) return;
    spot.el.setAttribute("data-file-over", "");
    return () => spot.el.removeAttribute("data-file-over");
  }, [spot]);

  return spot;
}

// A composer's side: the files handed to target (lib/file-drop.ts), now if they're already waiting
// (the thread just opened) and whenever more arrive. target is undefined until the editor is ready.
export function useHandedFiles(target: string | undefined, insert: (files: File[]) => void) {
  const take = useEffectEvent(() => {
    if (!target) return;
    const files = takeFiles(target);
    if (files.length) insert(files);
  });
  useEffect(() => {
    take();
    return onHandedFiles(take);
  }, [target]);
}
