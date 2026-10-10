import fs from "node:fs";
import path from "node:path";
import { publish } from "./bus";
import { DATA_DIR } from "./store";
import { MODES, type Automation, type PermissionMode, type Project, type SettingsView } from "./types";

// Appended to every board thread's system prompt (not the copilot's). The user can edit it in
// Settings; lib/status.ts parses the BOARD STATUS line it asks for, so keep that format.
export const DEFAULT_THREAD_PROMPT = `You're running as a card on Weft, a kanban board of AI coding threads with the columns Backlog, Running, Needs you, Review, and Done. The board moves your card based on a status line you write.

End every reply with this line, on a line of its own:
BOARD STATUS: column=<needs_you|review|done> | stage=<stage> | remaining=<what's left>

- column: needs_you when you're waiting on an answer or a decision from the user; review when you've finished work the user should look at; done when the task is finished and verified, with nothing left to review.
- stage: one of Planning, Pre-build refactoring, First shot, Going deeper, Polishing, Post-build refactoring, Cleaning up, Done.
- remaining: what's still open on the task, two to five words per item, comma-separated, or none.

You also have mcp__board__list_cards (read-only) and mcp__board__create_card (prompt, title, folder defaulting to yours, start defaulting to true) to hand work to a new thread. Check list_cards before creating a self-fix card so you don't duplicate one.

If another instruction also asks for a final status line, put the BOARD STATUS line just before it.`;

const MAX_PROJECTS = 40;

// What a new install starts with: moving a card to Done wraps it up with Weft's done skill.
const DEFAULT_AUTOMATIONS: Automation[] = [{ id: "default-done", on: "done", skill: "weft:done" }];

interface Settings {
  threadPrompt?: string;
  keepAliveMinutes?: number;
  // The mode a new thread starts in; unset means Auto.
  defaultPermissionMode?: PermissionMode;
  // Unset means the defaults; an empty list means the user removed them all.
  automations?: Automation[];
  projects: Project[];
  // Claude Code sessions whose cards were deleted, so syncing doesn't bring them back.
  dismissedSessions?: string[];
}

const FILE = path.join(DATA_DIR, "settings.json");
const g = globalThis as unknown as { __threadboardSettings?: Settings };

function settings(): Settings {
  if (!g.__threadboardSettings) {
    const saved = fs.existsSync(FILE) ? (JSON.parse(fs.readFileSync(FILE, "utf8")) as Partial<Settings>) : {};
    g.__threadboardSettings = {
      threadPrompt: saved.threadPrompt,
      keepAliveMinutes: saved.keepAliveMinutes,
      defaultPermissionMode: saved.defaultPermissionMode,
      automations: saved.automations,
      projects: saved.projects ?? [],
      dismissedSessions: saved.dismissedSessions ?? [],
    };
  }
  return g.__threadboardSettings;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(settings(), null, 2));
}

export function threadPrompt() {
  return settings().threadPrompt?.trim() || DEFAULT_THREAD_PROMPT;
}

// Empty text goes back to the default.
export function setThreadPrompt(text: string) {
  settings().threadPrompt = text.trim() || undefined;
  save();
}

// 0 (the default) keeps conversations open until the app quits.
export function keepAliveMinutes() {
  return settings().keepAliveMinutes ?? 0;
}

export function setKeepAliveMinutes(minutes: number) {
  // At most a week; 0 means until the app quits.
  settings().keepAliveMinutes = Math.min(7 * 24 * 60, Math.max(0, Math.round(minutes)));
  save();
}

export function defaultPermissionMode(): PermissionMode {
  const saved = settings().defaultPermissionMode;
  return saved && MODES.includes(saved) ? saved : "auto";
}

export function setDefaultPermissionMode(mode: PermissionMode) {
  settings().defaultPermissionMode = mode;
  save();
}

export function automations(): Automation[] {
  return settings().automations ?? DEFAULT_AUTOMATIONS;
}

export function setAutomations(list: Automation[]) {
  settings().automations = list;
  save();
}

export function dismissedSessions(): string[] {
  return settings().dismissedSessions ?? [];
}

export function dismissSession(sessionId: string) {
  const s = settings();
  s.dismissedSessions = [...new Set([...(s.dismissedSessions ?? []), sessionId])];
  save();
}

export function listProjects(): Project[] {
  return [...settings().projects].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

// Marks a project folder as just used, adding it to the recent list if it's new.
export function touchProject(folder: string) {
  const s = settings();
  s.projects = [{ path: folder, lastUsedAt: Date.now() }, ...s.projects.filter((p) => p.path !== folder)].slice(
    0,
    MAX_PROJECTS,
  );
  save();
  publish({ type: "projects", projects: listProjects() });
}

export function removeProject(folder: string) {
  const s = settings();
  s.projects = s.projects.filter((p) => p.path !== folder);
  save();
  publish({ type: "projects", projects: listProjects() });
}

export function settingsView(): SettingsView {
  return {
    threadPrompt: threadPrompt(),
    defaultThreadPrompt: DEFAULT_THREAD_PROMPT,
    keepAliveMinutes: keepAliveMinutes(),
    defaultPermissionMode: defaultPermissionMode(),
    automations: automations(),
    projects: listProjects(),
  };
}
