import type { MeterBalance } from "@aimhuge/billing";
import type { MenuItem } from "./card-menu";
import type { MediaKind } from "./media";
import type { PlanId } from "./billing/plans";
import type { TagInfo, TagRow } from "./tags";
import type { VaultBridge } from "./vault-view";
import type { VercelBridge } from "./vercel-view";
import type { SupabaseBridge } from "./supabase-view";
import type { BlastcpBridge } from "./blastcp-view";
import type { CloudflareBridge } from "./cloudflare-view";
import type { GithubStatus } from "./github-view";
import type { Webhook, WebhookInput, WebhookPatch } from "./webhooks";
import type { SubagentModel } from "./subagents";
import type {
  AccountProvider,
  AccountView,
  Automation,
  Backend,
  Card,
  CliStatus,
  Column,
  DevServerStatus,
  Effort,
  GithubRepo,
  LocalRepo,
  LoginView,
  PermissionMode,
  Project,
  QuestionReply,
  RestartStatus,
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
// open-card carries an id.
export type MenuAction = "new-thread" | "settings" | "open-card" | "find" | "terminal" | "add-webhook";

// The board's view of the signed-in user's billing (docs/architecture/billing.md). Mirrors the JSON the local
// /api/account/billing route returns, kept client-side so React components don't pull in server-only modules.
export interface BillingStatusView {
  org: { slug: string; name: string };
  plan: { id: PlanId; name: string };
  status: string;
  interval: "monthly" | "yearly" | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  puku: MeterBalance | null;
  manageUrl: string;
}
export type BillingClientView = BillingStatusView | { error: string } | null;

// Exposed by electron/preload.cjs; absent when the board runs in a normal browser tab.
export interface ShellBridge {
  desktop: true;
  // process.platform, e.g. "darwin".
  platform: string;
  // The page's zoom factor, 1 at Actual Size.
  zoomFactor?(): number;
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
  // Keep Working (electron/keep-working.cjs). Settings → General → Laptop mode uses this. Missing on
  // non-macOS and in shells that don't expose it.
  keepWorking?: {
    state(): Promise<{ mode: "off" | "threads" | "hours"; hours?: number; until?: number; running?: number | null }>;
    start(mode: "threads" | "hours", hours?: number): Promise<void>;
    stop(): Promise<void>;
    onChange(callback: () => void): () => void;
  };
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
  // The secrets vault in Electron main (lib/vault-view.ts). Missing in older shells.
  vault?: VaultBridge;
  // Vercel in Electron main (lib/vercel-view.ts). Missing in older shells.
  vercel?: VercelBridge;
  // Supabase in Electron main (lib/supabase-view.ts). Missing in older shells.
  supabase?: SupabaseBridge;
  // BlastCP in Electron main (lib/blastcp-view.ts). Missing in older shells.
  blastcp?: BlastcpBridge;
  // Cloudflare in Electron main (lib/cloudflare-view.ts). Missing in older shells.
  cloudflare?: CloudflareBridge;
  onMenu(callback: (action: MenuAction, payload?: string) => void): () => void;
  // The board's first cards are on screen; resolves to this launch's timing. Missing in older shells.
  startupReady?(): Promise<StartupResult>;
  // The startup screen's buttons; "relaunch" restarts Weft (a shell from before it ignores it). Missing in older shells.
  splashAction?(action: "retry" | "logs" | "quit" | "relaunch"): void;
}

// One launch's timing from electron/startup-timer.cjs: usual is the median of recent launches (null until
// there are a few), slowest is the longest phase.
export interface StartupResult {
  total: number;
  usual: number | null;
  slow: boolean;
  slowest: { name: string; label: string; ms: number };
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
  // Tags to start with (lib/tags.ts); they count as yours.
  tags?: string[];
  start: boolean;
}

export interface UploadedAttachment {
  name: string;
  path: string;
  url: string;
  kind: MediaKind;
  bytes: number;
}

// How long an upload waits for the server's reply once its bytes are sent.
export const UPLOAD_REPLY_MS = 60_000;

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
    // The bytes are all sent; a server too busy to answer in a minute shouldn't leave it spinning forever.
    let waiting: ReturnType<typeof setTimeout> | undefined;
    xhr.upload.onload = () => {
      waiting = setTimeout(() => {
        xhr.abort();
        reject(new Error("Weft's server didn't answer in a minute. Remove it and paste again."));
      }, UPLOAD_REPLY_MS);
    };
    xhr.onloadend = () => clearTimeout(waiting);
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

async function call<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "x-threadboard": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...(signal ? { signal } : {}),
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
  // ★ and tags. Tags are normalized on the server, become yours (tagsBy "user"), and new ones join the catalog.
  mark: (id: string, patch: { starred?: boolean; tags?: string[] }) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, patch),
  // The tag catalog (lib/tag-store.ts): every tag with its colour, description and card count, by name.
  tags: () => call<{ tags: TagRow[] }>("GET", "/api/tags"),
  createTag: (name: string, color?: string, description?: string) => call<{ tag: TagInfo }>("POST", "/api/tags", { name, color, description }),
  // rename gives it a new name on every card (merging into a tag that already has it).
  updateTag: (name: string, patch: { rename?: string; color?: string; description?: string }) =>
    call<{ tag: TagInfo }>("PATCH", "/api/tags", { name, ...patch }),
  deleteTag: (name: string) => call<{ ok: true }>("DELETE", "/api/tags", { name }),
  setStarred: (id: string, starred: boolean) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, { starred }),
  setTags: (id: string, tags: string[]) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, { tags }),
  // The user granted read access to a path outside the project. Persists on the card and queues
  // a /add-dir slash command for the live session so the in-flight turn can keep reading.
  setReadScope: (id: string, path: string) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, { readScope: path }),
  remove: (id: string) => call("DELETE", `/api/cards/${id}`),
  send: (id: string, text: string) => call<{ card: Card }>("POST", `/api/cards/${id}/messages`, { text }),
  // A stopped or failed card's Restart: its last message again, in a fresh CLI.
  restart: (id: string) => call<{ card: Card }>("POST", `/api/cards/${id}/messages`, { restart: true }),
  // Replaces your last message and the turn it started, stopping that turn if it's running.
  editLast: (id: string, text: string) => call<{ card: Card }>("POST", `/api/cards/${id}/messages`, { text, edit: true }),
  // Sends text to the thread at `at` (unix ms), even if Weft was closed then (it goes on the next start).
  schedule: (id: string, text: string, at: number) => call<{ card: Card }>("POST", `/api/cards/${id}/scheduled`, { text, at }),
  unschedule: (id: string, messageId: string) => call<{ card: Card }>("DELETE", `/api/cards/${id}/scheduled`, { messageId }),
  // pendingId is the request the user saw; the server refuses the answer if another is in front.
  // reply: a question's notes, or "Chat about this" instead of answers.
  answer: (id: string, allow: boolean, answers?: Record<string, string>, pendingId?: string, reply?: QuestionReply) =>
    call("POST", `/api/cards/${id}/permission`, { allow, answers, pendingId, ...reply }),
  stop: (id: string) => call("POST", `/api/cards/${id}/stop`),
  // "!" in the reply box: runs a shell command in the card's folder (lib/shell.ts).
  shell: (id: string, command: string) => call<{ ok: true }>("POST", `/api/cards/${id}/shell`, { command }),
  // Stops the Claude CLI that has a picked-up session open in another app.
  release: (id: string) => call<{ stopped: number }>("POST", `/api/cards/${id}/release`),
  // Flips a card's CLI, or with model picks one of its models (same CLI: no new session). replay=true re-sends the last user message (the rate-limit escape hatch).
  switchBackend: (id: string, backend: Backend, replay = false, model?: string) =>
    call<{ card: Card }>("POST", `/api/cards/${id}/switch-backend`, { backend, replay, model }),
  // Column-level "Switch all to <other>". Busy cards come back in `pending` so the column can
  // confirm with the user before retrying.
  switchBackends: (ids: string[], backend: Backend) =>
    call<{ switched: string[]; failed: { id: string; error: string }[]; pending: string[] }>(
      "POST",
      "/api/cards/switch-backend",
      { ids, backend },
    ),
  devStatus: (id: string) => call<{ status: DevServerStatus }>("GET", `/api/cards/${id}/dev`),
  devAction: (id: string, action: "start" | "restart" | "stop") =>
    call<{ status: DevServerStatus }>("POST", `/api/cards/${id}/dev`, { action }),
  copilot: () => call<{ card: Card }>("GET", "/api/copilot"),
  resetCopilot: () => call<{ card: Card }>("POST", "/api/copilot/reset"),
  // Restart when idle (lib/restart-when-idle.ts): nothing new starts, and Weft restarts once the running turns end.
  restartStatus: () => call<RestartStatus>("GET", "/api/restart"),
  restartWhenIdle: () => call<RestartStatus>("POST", "/api/restart", {}),
  cancelRestart: () => call<RestartStatus>("DELETE", "/api/restart"),
  settings: () => call<SettingsView>("GET", "/api/settings"),
  saveSettings: (patch: {
    threadPrompt?: string;
    keepAliveMinutes?: number;
    defaultPermissionMode?: PermissionMode;
    defaultBackend?: Backend;
    automations?: Automation[];
    pushOnDone?: boolean;
    subagentModel?: SubagentModel;
    doneModel?: string;
    doneEffort?: Effort | "";
  }) =>
    call<SettingsView>("PATCH", "/api/settings", patch),
  addProject: (path: string) => call<{ path: string; projects: Project[] }>("POST", "/api/projects", { path }),
  newProject: (parent: string, name: string) =>
    call<{ path: string; projects: Project[] }>("POST", "/api/projects/new", { parent, name }),
  removeProject: (path: string) => call<{ projects: Project[] }>("DELETE", "/api/projects", { path }),
  loginStatus: () => call<{ status: Record<Backend, CliStatus>; runs: LoginView[] }>("GET", "/api/login"),
  login: (backend: Backend, action: "start" | "input" | "cancel" | "terminal", text?: string, signal?: AbortSignal) =>
    call<{ login: LoginView | null }>("POST", "/api/login", { backend, action, text }, signal),
  // Starts a CLI ahead of time: a card's own, or a spare in a project folder.
  warm: (body: { cardId?: string; cwd?: string; backend?: Backend }) => call<{ ok: true }>("POST", "/api/warm", body),
  // The splash page the browser pane shows beside the New thread dialog.
  newThreadPage: () => call<{ url: string }>("POST", "/api/new-thread-page", {}),
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
  // Your Weft account (lib/account.ts). signIn returns the provider's page to open in the system browser.
  account: () => call<AccountView>("GET", "/api/account"),
  signIn: (provider: AccountProvider, next?: string) =>
    call<{ url: string }>("POST", "/api/account", { action: "oauth", provider, ...(next ? { next } : {}) }),
  magicLink: (email: string) => call<{ ok: true }>("POST", "/api/account", { action: "email", email }),
  signOut: () => call<{ ok: true }>("POST", "/api/account", { action: "signout" }),
  // The signed-in user's billing status (lib/billing-client.ts); null when signed out, { error } on a failure.
  billingStatus: () => call<BillingClientView>("GET", "/api/account/billing"),
  cloneRepo: (fullName: string) => call<{ path: string; projects: Project[] }>("POST", "/api/repos/clone", { fullName }),
  // A folder's open GitHub issues as Backlog cards, now and every 5 minutes after (lib/github-issues.ts).
  importIssues: (folder: string) =>
    call<{ folder: string; added: number; updated: number; archived: number }>("POST", "/api/github/issues", { folder }),
  stopIssues: (folder: string) => call<{ folders: string[] }>("DELETE", "/api/github/issues", { folder }),
  // A webhook on the folder's repo, relayed by Weft's Supabase, so its issues sync within seconds (lib/github-hooks.ts).
  addHook: (folder: string) => call<{ repo: string }>("POST", "/api/github/hooks", { folder }),
  removeHook: (folder: string) => call<{ ok: true }>("DELETE", "/api/github/hooks", { folder }),
  // Live pull from Vercel: a team webhook relayed by Weft's Supabase pulls new env variables into the vault (lib/vercel-hooks.ts).
  vercelHooks: () => call<{ signedIn: boolean; teams: string[] }>("GET", "/api/vercel/hooks"),
  addVercelHook: (folder: string) => call<{ team: string }>("POST", "/api/vercel/hooks", { folder }),
  removeVercelHook: (folder: string) => call<{ ok: true }>("DELETE", "/api/vercel/hooks", { folder }),
  // The GitHub drawer: who gh is signed in as, and each folder's repo and issue sync (lib/github-status.ts).
  github: (folders: string[]) => call<GithubStatus>("GET", `/api/github?${new URLSearchParams(folders.map((f) => ["folder", f]))}`),
  // The 🪝 drawer: each folder's webhooks, and a public relay URL for one (lib/webhooks.ts; signedIn: the relay needs a Weft account).
  webhooks: (folders: string[]) => call<{ hooks: Webhook[]; signedIn: boolean }>("GET", `/api/webhooks?${new URLSearchParams(folders.map((f) => ["folder", f]))}`),
  addWebhook: (input: WebhookInput) => call<{ hook: Webhook; existed: boolean }>("POST", "/api/webhooks", input),
  updateWebhook: (id: string, patch: WebhookPatch) => call<{ hook: Webhook }>("PATCH", `/api/webhooks/${id}`, patch),
  removeWebhook: (id: string) => call<{ ok: true }>("DELETE", `/api/webhooks/${id}`),
  relayWebhook: (id: string) => call<{ hook: Webhook }>("POST", `/api/webhooks/${id}/relay`),
  unrelayWebhook: (id: string) => call<{ hook: Webhook }>("DELETE", `/api/webhooks/${id}/relay`),
};

// A thread snapshot with the live items that arrived while it loaded, which are newer than it.
export function mergeThread(snapshot: ThreadItem[], live: (ThreadItem | undefined)[]): ThreadItem[] {
  const next = snapshot.slice();
  live.forEach((item, i) => {
    if (item) next[i] = item;
  });
  return next;
}
