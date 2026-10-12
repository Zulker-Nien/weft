"use client";

import { useEffect, useState } from "react";

// A thread that leaves a file half-written (a stray `}` in Board.tsx) breaks the build, not the render, so no error
// boundary sees it: Next's dev server fails the whole route, and the board already on screen keeps running the last
// version that compiled. Next covers it with its Build Error overlay, which can't be closed. We read that overlay
// instead, hide it (globals.css, `html[data-build-error]`) and draw a small bar of our own, so the board stays usable
// until the edit lands and Fast Refresh picks it up.
export type BuildError = { message: string; file: string | null };

// "./components/Board.tsx (1000:1)", as the overlay's code frame names the file.
const FILE = /(\.\/[^\s()]+\.[a-z]+ \(\d+:\d+\))/;

/** The build error Next's dev overlay is showing in `root` (its shadow root), or null when it shows none. */
export function readBuildError(root: ParentNode | null | undefined): BuildError | null {
  const label = root?.querySelector("#nextjs__container_errors_label")?.textContent ?? "";
  if (!/build error/i.test(label)) return null;
  const message = root?.querySelector("#nextjs__container_errors_desc")?.textContent.trim() || "The build failed";
  const file = (root as Node).textContent?.match(FILE)?.[1] ?? null;
  return { message, file };
}

function current() {
  return readBuildError(document.querySelector("nextjs-portal")?.shadowRoot);
}

const POLL_MS = 1000;

/** The build error Next is reporting right now (dev mode only), checked once a second. */
export function useBuildError() {
  const [error, setError] = useState<BuildError | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const check = () =>
      setError((prev) => {
        const next = current();
        return prev?.message === next?.message && prev?.file === next?.file ? prev : next;
      });
    check();
    const timer = setInterval(check, POLL_MS);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (error) root.dataset.buildError = "";
    else delete root.dataset.buildError;
  }, [error]);
  return error;
}
