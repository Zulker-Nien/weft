"use client";

import { createContext, useContext } from "react";
import type { FileIndex } from "@/lib/file-refs";

// The card id used by the thread's clickable file links (tool rows, inline code in markdown,
// the permission prompt's edit file). A thread inside the board passes its card id; everywhere
// else, the context is null and the links don't render.

export const FileLinkContext = createContext<string | null>(null);

export function useFileLink(): string | null {
  return useContext(FileLinkContext);
}

// The card's file list (lib/use-file-index.ts), so file names in prose and inline code link only when the file
// is really there. Null while it loads, and on surfaces with no file list.
export const FileIndexContext = createContext<FileIndex | null>(null);

export function useFileIndexContext(): FileIndex | null {
  return useContext(FileIndexContext);
}
