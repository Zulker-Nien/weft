// Opening a file in the open card's editor column (components/EditorColumn.tsx) from anywhere in its
// thread: a tool row's path, a path in inline code, the permission prompt's file. One window event, so the
// thread's components don't need a handle on the editor; the editor listens for its own card's events.

export interface OpenFileRequest {
  cardId: string;
  // Relative to the card's folder, or absolute (the editor makes it relative, and refuses outside paths).
  path: string;
  // 1-based line to scroll to, from a "file.ts:42" reference.
  line?: number;
  // Open on the file's changes against git HEAD rather than the plain editor.
  diff?: boolean;
}

export const OPEN_FILE_EVENT = "weft:open-file";

// Requests not yet taken by an editor: the column may be closed (unmounted) when a path is clicked, so the
// board opens it and the editor drains these as it mounts.
const waiting: OpenFileRequest[] = [];

export function openFile(request: OpenFileRequest): void {
  waiting.push(request);
  window.dispatchEvent(new CustomEvent<OpenFileRequest>(OPEN_FILE_EVENT, { detail: request }));
}

// Takes (and forgets) the waiting requests for `cardId`, oldest first.
export function drainOpenFiles(cardId: string): OpenFileRequest[] {
  const mine = waiting.filter((r) => r.cardId === cardId);
  for (const r of mine) waiting.splice(waiting.indexOf(r), 1);
  return mine;
}

// Calls `handle` for each request aimed at `cardId`; returns the unsubscribe.
export function onOpenFile(cardId: string, handle: (request: OpenFileRequest) => void): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<OpenFileRequest | undefined>).detail;
    if (detail && detail.cardId === cardId) handle(detail);
  };
  window.addEventListener(OPEN_FILE_EVENT, listener);
  return () => window.removeEventListener(OPEN_FILE_EVENT, listener);
}

// "lib/turn.ts", "./README.md:12", "/Users/me/app/x.tsx:3:5", "docs/ROADMAP.md" read as file references;
// "npm run dev", "foo()", "https://…", "v1.2" and bare words don't. A name needs an extension or a slash.
const PATH = /^(?:\.{0,2}\/|~\/)?(?:[\w@.+-]+\/)*[\w@+-][\w@.+-]*\.[A-Za-z0-9]{1,10}(?::(\d+)(?::\d+)?)?$/;
const DIR_PATH = /^(?:\.{0,2}\/)?(?:[\w@.+-]+\/)+[\w@.+-]+(?::(\d+))?$/;

export function parseFileRef(text: string): { path: string; line?: number } | null {
  const t = text.trim();
  if (!t || t.length > 300 || /\s/.test(t) || /^[a-z][a-z+.-]*:\/\//i.test(t)) return null;
  // A version or a number ("1.2.3", "0.5") isn't a file.
  if (/^v?\d+(\.\d+)+$/.test(t)) return null;
  const m = PATH.exec(t) ?? DIR_PATH.exec(t);
  if (!m) return null;
  const line = m[1] ? Number(m[1]) : undefined;
  const path = m[1] ? t.slice(0, t.indexOf(":" + m[1])) : t;
  return line ? { path, line } : { path };
}
