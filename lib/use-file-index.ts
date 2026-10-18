"use client";

import { useEffect, useRef, useState } from "react";
import { buildFileIndex, type FileIndex } from "./file-refs";

// The open card's file list as a FileIndex (lib/file-refs.ts), for linking file names in its thread. Read once
// when the thread opens and again when `version` moves (the thread grew, so it may have made files), at most
// every REFRESH_MS. A transport without listFiles (weft.zip) gets null, and the thread links nothing.

export const REFRESH_MS = 15_000;

export function useFileIndex(
  cardId: string,
  cwd: string,
  listFiles: ((cardId: string) => Promise<string[]>) | undefined,
  version: number,
): FileIndex | null {
  const [index, setIndex] = useState<FileIndex | null>(null);
  const lastRead = useRef(0);

  useEffect(() => {
    if (!listFiles || Date.now() - lastRead.current < REFRESH_MS) return;
    lastRead.current = Date.now();
    let live = true;
    listFiles(cardId).then(
      (files) => {
        if (live) setIndex(buildFileIndex(files, cwd));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [cardId, cwd, listFiles, version]);

  return listFiles ? index : null;
}
