import type { Backend, Card, CliStatus, Column, LoginView, PermissionMode, Project, SettingsView, ThreadItem } from "./types";

export interface BrowserState {
  visible: boolean;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

// What the app menu, dock, tray, and global shortcuts ask a window to do. open-card carries a card id.
export type MenuAction = "new-thread" | "settings" | "open-card" | "find";

// Exposed by electron/preload.cjs; absent when the board runs in a normal browser tab.
export interface ShellBridge {
  desktop: true;
  // process.platform, e.g. "darwin".
  platform: string;
  browser: {
    open(url: string): Promise<unknown>;
    getState(): Promise<BrowserState>;
    setVisible(visible: boolean): void;
    setBounds(rect: { x: number; y: number; width: number; height: number }): void;
    back(): void;
    forward(): void;
    reload(): void;
    onState(callback: (state: BrowserState) => void): () => void;
  };
  dialog: {
    // A native folder picker; resolves to null when cancelled.
    openFolder(): Promise<string | null>;
  };
  // Opens an http(s) URL in the default browser.
  openExternal(url: string): void;
  // The dock badge, e.g. how many cards need the user.
  setBadge(count: number): void;
  copilot: {
    toggle(): void;
    onState(callback: (state: { open: boolean }) => void): () => void;
  };
  onMenu(callback: (action: MenuAction, payload?: string) => void): () => void;
}

declare global {
  interface Window {
    threadboard?: ShellBridge;
  }
}

export interface NewCardInput {
  title: string;
  prompt: string;
  cwd: string;
  backend: Backend;
  permissionMode: PermissionMode;
  start: boolean;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "x-threadboard": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as T;
}

export const api = {
  list: () => call<{ cards: Card[]; home: string }>("GET", "/api/cards"),
  create: (input: NewCardInput) => call<{ card: Card }>("POST", "/api/cards", input),
  move: (id: string, column: Column) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, { column }),
  remove: (id: string) => call("DELETE", `/api/cards/${id}`),
  send: (id: string, text: string) => call<{ card: Card }>("POST", `/api/cards/${id}/messages`, { text }),
  // pendingId is the request the user saw; the server refuses the answer if another is in front.
  answer: (id: string, allow: boolean, answers?: Record<string, string>, pendingId?: string) =>
    call("POST", `/api/cards/${id}/permission`, { allow, answers, pendingId }),
  stop: (id: string) => call("POST", `/api/cards/${id}/stop`),
  copilot: () => call<{ card: Card }>("GET", "/api/copilot"),
  resetCopilot: () => call<{ card: Card }>("POST", "/api/copilot/reset"),
  settings: () => call<SettingsView>("GET", "/api/settings"),
  saveSettings: (patch: { threadPrompt?: string; keepAliveMinutes?: number }) =>
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
  thread: (id: string) => call<{ items: ThreadItem[] }>("GET", `/api/cards/${id}/thread`),
};

// A thread snapshot with the live items that arrived while it loaded, which are newer than it.
export function mergeThread(snapshot: ThreadItem[], live: ThreadItem[]): ThreadItem[] {
  const next = snapshot.slice();
  live.forEach((item, i) => {
    if (item) next[i] = item;
  });
  return next;
}
