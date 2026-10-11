import type { MenuItem } from "./card-menu";
import type { MediaKind } from "./media";
import type {
  Automation,
  Backend,
  Card,
  CliStatus,
  Column,
  DevServerStatus,
  Effort,
  GithubRepo,
  LibraryItem,
  LibraryKind,
  LibraryScope,
  LocalRepo,
  LoginView,
  PermissionMode,
  Project,
  SettingsView,
  SkillInfo,
  ThreadItem,
} from "./types";

export interface BrowserState {
  visible: boolean;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  // The page's zoom, in percent. A shell from before zoom reporting sends none.
  zoom?: number;
}

// What the app menu, dock, tray, global shortcuts and weft:// links ask a window to do.
// open-card and run-recipe carry an id.
export type MenuAction = "new-thread" | "settings" | "open-card" | "find" | "terminal" | "run-recipe";

// Exposed by electron/preload.cjs; absent when the board runs in a normal browser tab.
export interface ShellBridge {
  desktop: true;
  // process.platform, e.g. "darwin".
  platform: string;
  browser: {
    // key is the card whose browser to load into; each card has its own, and the open card's is on screen.
    open(url: string, key?: string): Promise<unknown>;
    // Shows a card's browser, or the board's own with no card open.
    setActive(key: string | null): void;
    // Closes the browsers of cards not in keys.
    prune(keys: string[]): void;
    getState(): Promise<BrowserState>;
    setVisible(visible: boolean): void;
    setBounds(rect: { x: number; y: number; width: number; height: number }): void;
    back(): void;
    forward(): void;
    reload(): void;
    // "in", "out", "reset", or a percentage.
    zoom(action: "in" | "out" | "reset" | number): void;
    onState(callback: (state: BrowserState) => void): () => void;
  };
  dialog: {
    // A native folder picker; resolves to null when cancelled.
    openFolder(): Promise<string | null>;
  };
  // Opens an http(s) URL in the default browser.
  openExternal(url: string): void;
  // Opens a local folder in Finder.
  revealFolder(folder: string): void;
  // A native context menu at the pointer (lib/card-menu.ts); resolves to the picked id, or null.
  popupMenu(items: MenuItem[]): Promise<string | null>;
  // The dock badge, e.g. how many cards need the user.
  setBadge(count: number): void;
  copilot: {
    toggle(): void;
    onState(callback: (state: { open: boolean }) => void): () => void;
  };
  // Shells for the terminal drawer, keyed by id. open reattaches to a running one and replays its output.
  terminal: {
    open(id: string, cwd: string, cols: number, rows: number): Promise<{ replay?: string; cwd?: string; error?: string }>;
    write(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
    kill(id: string): void;
    onData(callback: (id: string, data: string) => void): () => void;
    onExit(callback: (id: string, code: number) => void): () => void;
  };
  onMenu(callback: (action: MenuAction, payload?: string) => void): () => void;
}

declare global {
  interface Window {
    threadboard?: ShellBridge;
  }
}

export interface NewCardInput {
  // Left out, the server names the card from its prompt.
  title?: string;
  prompt: string;
  cwd: string;
  backend: Backend;
  // Left out, the server uses the default permission mode from settings.
  permissionMode?: PermissionMode;
  model?: string;
  effort?: Effort;
  // The library recipe it runs, if it came from one.
  recipeId?: string;
  start: boolean;
}

export interface UploadedAttachment {
  name: string;
  path: string;
  url: string;
  kind: MediaKind;
  bytes: number;
}

// Uploads a pasted or dropped file as-is. XHR rather than fetch, for upload progress (0 to 1).
function upload(file: Blob, name: string, onProgress?: (fraction: number) => void) {
  return new Promise<UploadedAttachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/attachments");
    xhr.setRequestHeader("x-threadboard", "1");
    xhr.setRequestHeader("x-filename", encodeURIComponent(name));
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: { error?: string } & Partial<UploadedAttachment> = {};
      try {
        data = JSON.parse(xhr.responseText) as typeof data;
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && data.path) resolve(data as UploadedAttachment);
      else reject(new Error(data.error ?? `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Upload failed."));
    xhr.send(file);
  });
}

async function transcribe(audio: Blob) {
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "x-threadboard": "1", "content-type": audio.type || "audio/webm" },
    body: audio,
  });
  const data = (await res.json()) as { text?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data.text ?? "";
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "x-threadboard": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

export const api = {
  list: () => call<{ cards: Card[]; home: string; roots: Record<string, string> }>("GET", "/api/cards"),
  create: (input: NewCardInput) => call<{ card: Card }>("POST", "/api/cards", input),
  move: (id: string, column: Column) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, { column }),
  rename: (id: string, title: string) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, { title }),
  setMode: (id: string, permissionMode: PermissionMode) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, { permissionMode }),
  archive: (id: string, archived: boolean) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, { archived }),
  remove: (id: string) => call("DELETE", `/api/cards/${id}`),
  send: (id: string, text: string) => call<{ card: Card }>("POST", `/api/cards/${id}/messages`, { text }),
  // Sends text to the thread at `at` (unix ms), even if Weft was closed then (it goes on the next start).
  schedule: (id: string, text: string, at: number) => call<{ card: Card }>("POST", `/api/cards/${id}/scheduled`, { text, at }),
  unschedule: (id: string, messageId: string) => call<{ card: Card }>("DELETE", `/api/cards/${id}/scheduled`, { messageId }),
  // pendingId is the request the user saw; the server refuses the answer if another is in front.
  answer: (id: string, allow: boolean, answers?: Record<string, string>, pendingId?: string) =>
    call("POST", `/api/cards/${id}/permission`, { allow, answers, pendingId }),
  stop: (id: string) => call("POST", `/api/cards/${id}/stop`),
  // Stops the Claude CLI that has a picked-up session open in another app.
  release: (id: string) => call<{ stopped: number }>("POST", `/api/cards/${id}/release`),
  devStatus: (id: string) => call<{ status: DevServerStatus }>("GET", `/api/cards/${id}/dev`),
  devAction: (id: string, action: "start" | "restart" | "stop") =>
    call<{ status: DevServerStatus }>("POST", `/api/cards/${id}/dev`, { action }),
  copilot: () => call<{ card: Card }>("GET", "/api/copilot"),
  resetCopilot: () => call<{ card: Card }>("POST", "/api/copilot/reset"),
  settings: () => call<SettingsView>("GET", "/api/settings"),
  saveSettings: (patch: {
    threadPrompt?: string;
    keepAliveMinutes?: number;
    defaultPermissionMode?: PermissionMode;
    automations?: Automation[];
  }) =>
    call<SettingsView>("PATCH", "/api/settings", patch),
  addProject: (path: string) => call<{ path: string; projects: Project[] }>("POST", "/api/projects", { path }),
  newProject: (parent: string, name: string) =>
    call<{ path: string; projects: Project[] }>("POST", "/api/projects/new", { parent, name }),
  removeProject: (path: string) => call<{ projects: Project[] }>("DELETE", "/api/projects", { path }),
  loginStatus: () => call<{ status: Record<Backend, CliStatus>; runs: LoginView[] }>("GET", "/api/login"),
  login: (backend: Backend, action: "start" | "input" | "cancel" | "terminal", text?: string) =>
    call<{ login: LoginView | null }>("POST", "/api/login", { backend, action, text }),
  // Starts a CLI ahead of time: a card's own, or a spare in a project folder.
  warm: (body: { cardId?: string; cwd?: string; backend?: Backend }) => call<{ ok: true }>("POST", "/api/warm", body),
  // folder picks which project's recipes the page offers.
  newThreadPage: (folder?: string | null) => call<{ url: string }>("POST", "/api/new-thread-page", { folder }),
  // The library (lib/library.ts): yours plus one project's, or every project's (all).
  library: (folder?: string | null, all = false) =>
    call<{ items: LibraryItem[] }>("GET", `/api/library?${all ? "all=1" : folder ? `folder=${encodeURIComponent(folder)}` : ""}`),
  star: (cardId: string, kind: LibraryKind, scope: LibraryScope = "project") =>
    call<{ item: LibraryItem }>("POST", "/api/library", { cardId, kind, scope }),
  updateLibraryItem: (id: string, patch: { title?: string; kind?: LibraryKind; scope?: LibraryScope; ticked?: number[] }) =>
    call<{ item: LibraryItem }>("PATCH", `/api/library/${id}`, patch),
  removeLibraryItem: (id: string) => call("DELETE", `/api/library/${id}`),
  // Prompts the user wrote, in cards on the board. Matched words in each snippet sit between \u0001 and \u0002.
  searchPrompts: (q: string) =>
    call<{ hits: { cardId: string; at: number; snippet: string }[]; indexing: boolean }>("GET", `/api/search?q=${encodeURIComponent(q)}`),
  thread: (id: string) => call<{ items: ThreadItem[] }>("GET", `/api/cards/${id}/thread`),
  // Weft's skills and yours; with cwd, that folder's too.
  skills: (cwd?: string) =>
    call<{ skills: SkillInfo[] }>("GET", `/api/skills${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`),
  uploadAttachment: upload,
  dictation: () => call<{ available: boolean; reason?: string; model?: string }>("GET", "/api/transcribe"),
  transcribe,
  repos: (fresh = false) => call<{ repos: LocalRepo[] }>("GET", `/api/repos${fresh ? "?fresh=1" : ""}`),
  githubRepos: (fresh = false) => call<{ repos: GithubRepo[] }>("GET", `/api/repos/github${fresh ? "?fresh=1" : ""}`),
  cloneRepo: (fullName: string) => call<{ path: string; projects: Project[] }>("POST", "/api/repos/clone", { fullName }),
};

// A thread snapshot with the live items that arrived while it loaded, which are newer than it.
export function mergeThread(snapshot: ThreadItem[], live: (ThreadItem | undefined)[]): ThreadItem[] {
  const next = snapshot.slice();
  live.forEach((item, i) => {
    if (item) next[i] = item;
  });
  return next;
}
