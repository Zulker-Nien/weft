// Open files in the editor column, one set per card, persisted in localStorage. A path is keyed the
// same whether it was opened as an absolute or a relative one (the editor normalizes on open), and
// deduped by case-sensitive equality. Tabs have a mode (edit | changes | source) — `edit` is the
// default for code files, `source` is the markdown WYSIWYG's "Source" view, `changes` is the diff
// against git HEAD. The same file can be open in two modes only as one tab whose mode toggles.

export type EditorMode = "edit" | "changes" | "source";

export interface EditorTab {
  path: string;
  mode: EditorMode;
}

export interface EditorTabsState {
  tabs: EditorTab[];
  activePath: string | null;
}

// One card, one set. Keyed by card id so different cards' open files don't bleed across.
export const TABS_STORAGE_KEY = (cardId: string) => `weft-editor-tabs:${cardId}`;

// The modes a non-markdown file supports. Markdown gets `source` instead of `edit` for the WYSIWYG
// view, but it can still fall back to a plain `edit` when the WYSIWYG fails to mount.
const MARKDOWN_EXT = /\.(md|mdx|markdown)$/i;

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXT.test(path);
}

export function defaultMode(path: string): EditorMode {
  return isMarkdownPath(path) ? "edit" : "edit";
}

// Markdown files get the WYSIWYG (`edit`) and the `source` toggle; others only `edit` and `changes`.
export function allowedModes(path: string): EditorMode[] {
  if (isMarkdownPath(path)) return ["edit", "source"];
  return ["edit", "changes"];
}

// A path passed in absolute and pointing inside `cwd` becomes a relative one; outside the folder is
// refused with `null`. Empty paths, paths that aren't strings, and paths that escape the cwd are
// rejected so the server (lib/file-access.ts) can trust whatever it gets.
export function normalizePath(path: string, cwd: string): string | null {
  if (typeof path !== "string" || !path) return null;
  if (!path.startsWith("/")) {
    // Already relative: disallow leading ".." that would walk out of the folder, otherwise leave it.
    const segs = path.split("/");
    let depth = 0;
    for (const seg of segs) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        depth -= 1;
        if (depth < 0) return null;
      } else {
        depth += 1;
      }
    }
    return path;
  }
  // Absolute: must sit inside cwd. Compare with a trailing slash so "/Users/me/dev" doesn't accept
  // "/Users/me/developer".
  const root = cwd.endsWith("/") ? cwd : `${cwd}/`;
  if (path !== cwd && !path.startsWith(root)) return null;
  const rel = path.slice(cwd.length);
  return rel.startsWith("/") ? rel.slice(1) : rel;
}

function isModeAllowed(mode: EditorMode, path: string): boolean {
  return allowedModes(path).includes(mode);
}

function clampMode(mode: EditorMode, path: string): EditorMode {
  return isModeAllowed(mode, path) ? mode : "edit";
}

function withTab(state: EditorTabsState, tab: EditorTab, makeActive: boolean): EditorTabsState {
  return {
    tabs: [...state.tabs, tab],
    activePath: makeActive || !state.activePath ? tab.path : state.activePath,
  };
}

function withoutTab(state: EditorTabsState, path: string): EditorTabsState {
  const tabs = state.tabs.filter((t) => t.path !== path);
  if (state.activePath !== path) return { ...state, tabs };
  const next = tabs[tabs.length - 1]?.path ?? null;
  return { tabs, activePath: next };
}

export function openTab(state: EditorTabsState, path: string, cwd: string): EditorTabsState {
  const normalized = normalizePath(path, cwd);
  if (!normalized) return state;
  const current = state.tabs.find((t) => t.path === normalized);
  if (current) {
    return { ...state, activePath: normalized };
  }
  return withTab(state, { path: normalized, mode: "edit" }, true);
}

export function setActive(state: EditorTabsState, path: string): EditorTabsState {
  if (!state.tabs.some((t) => t.path === path)) return state;
  if (state.activePath === path) return state;
  return { ...state, activePath: path };
}

export function closeTab(state: EditorTabsState, path: string): EditorTabsState {
  return withoutTab(state, path);
}

export function setMode(state: EditorTabsState, path: string, mode: EditorMode): EditorTabsState {
  const idx = state.tabs.findIndex((t) => t.path === path);
  if (idx < 0) return state;
  const safe = clampMode(mode, path);
  if (state.tabs[idx]?.mode === safe) return state;
  const tabs = state.tabs.map((t, i) => (i === idx ? { ...t, mode: safe } : t));
  return { ...state, tabs };
}

// Reads one stored tab entry; returns the cleaned tab or null if it's invalid.
function parseStoredTab(t: unknown): EditorTab | null {
  if (!t || typeof t !== "object") return null;
  const obj = t as { path?: unknown; mode?: unknown };
  if (typeof obj.path !== "string" || obj.path.length === 0) return null;
  if (obj.mode !== "edit" && obj.mode !== "changes" && obj.mode !== "source") return null;
  return { path: obj.path, mode: clampMode(obj.mode, obj.path) };
}

// Reads the stored array of tabs; drops anything that isn't a valid tab.
function parseStoredTabs(rawTabs: unknown): EditorTab[] {
  if (!Array.isArray(rawTabs)) return [];
  const out: EditorTab[] = [];
  for (const t of rawTabs) {
    const tab = parseStoredTab(t);
    if (tab) out.push(tab);
  }
  return out;
}

function resolveActive(stored: unknown, tabs: EditorTab[]): string | null {
  if (typeof stored === "string" && tabs.some((t) => t.path === stored)) return stored;
  return tabs[0]?.path ?? null;
}

function emptyTabs(): EditorTabsState {
  return { tabs: [], activePath: null };
}

export function loadTabs(cardId: string): EditorTabsState {
  if (typeof localStorage === "undefined") return emptyTabs();
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY(cardId));
    if (!raw) return emptyTabs();
    const parsed = JSON.parse(raw) as Partial<EditorTabsState> | null;
    if (!parsed) return emptyTabs();
    const tabs = parseStoredTabs(parsed.tabs);
    return { tabs, activePath: resolveActive(parsed.activePath, tabs) };
  } catch {
    return emptyTabs();
  }
}

export function saveTabs(cardId: string, state: EditorTabsState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(TABS_STORAGE_KEY(cardId), JSON.stringify(state));
  } catch {
    // Quota or denied: best effort. The state is still in memory; the next save will retry.
  }
}

export function fileName(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}
