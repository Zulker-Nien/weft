export const COLUMNS = [
  { id: "backlog", label: "Backlog" },
  { id: "running", label: "Running" },
  { id: "needs_you", label: "Needs you" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
] as const;

// The copilot is one long-lived thread with this fixed id, kept off the board.
export const COPILOT_ID = "copilot";

export type Column = (typeof COLUMNS)[number]["id"];
export type Backend = "claude" | "puku";
// bypassPermissions is "YOLO": every tool runs without asking.
export type PermissionMode = "default" | "acceptEdits" | "auto" | "bypassPermissions";
export const MODES: PermissionMode[] = ["default", "acceptEdits", "auto", "bypassPermissions"];

// How the pickers (new thread, thread header, card menu) name each mode, loosest first.
export const MODE_OPTIONS: { id: PermissionMode; label: string; hint: string }[] = [
  { id: "bypassPermissions", label: "YOLO", hint: "Runs every tool without asking" },
  { id: "auto", label: "Auto", hint: "A classifier approves or asks" },
  { id: "acceptEdits", label: "Accept edits", hint: "Edits files freely, asks before commands" },
  { id: "default", label: "Ask me", hint: "Asks before each tool" },
];

// A mode Claude Code recorded (or a setting) as the closest one Weft runs; undefined if unknown.
// "plan" only reads, so it maps to "default", the mode that asks before anything changes.
export function toPermissionMode(raw: unknown): PermissionMode | undefined {
  if (MODES.includes(raw as PermissionMode)) return raw as PermissionMode;
  if (raw === "plan" || raw === "dontAsk") return "default";
  return undefined;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// A question the agent asked with its AskUserQuestion tool.
export interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}

export interface PendingPermission {
  id: string;
  toolName: string;
  title: string;
  input: Record<string, unknown>;
  // Set when the agent asked questions instead of asking to use a tool.
  questions?: Question[];
}

// One plan rate-limit window: how much is used (0-100) and when it resets (unix seconds).
export interface LimitWindow {
  used: number;
  resetsAt?: number;
}

// The prompt cache after the thread's last request: when it went out (unix ms), how long the cache
// lives after it (seconds), the share of it read from cache (0-100), and its size in tokens, which is
// what the next request sends again at full price once the cache has gone cold.
export interface CacheState {
  at: number;
  ttl: number;
  hit: number;
  tokens: number;
}

// What the thread panel's status strip shows (see components/StatusStrip.tsx).
export interface CardStats {
  model?: string;
  // The folder's git branch, when it is a repo.
  branch?: string;
  // Share of the model's context window the last turn filled, 0-100.
  contextUsed?: number;
  tokens?: number;
  // Lines added and removed in the folder's working tree (git diff against HEAD).
  added?: number;
  removed?: number;
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  cache?: CacheState;
}

// A message written now and sent to the thread later, at `at` (unix ms).
export interface ScheduledMessage {
  id: string;
  text: string;
  at: number;
}

// A thread's tour of what it built, for the user to step through in Review (see lib/review.ts).
export interface ReviewStep {
  title: string;
  // What to try and what should happen.
  look?: string;
  // The page for this step: a path on the plan's url, or a full URL.
  path?: string;
}

export interface ReviewPlan {
  // Where the running web app is; without it the steps are read-only.
  url?: string;
  // The shell command that starts that app (run in the card's folder), so Weft can start it and keep it up.
  dev?: string;
  steps: ReviewStep[];
}

export interface DevServerStatus {
  state: "stopped" | "starting" | "running" | "failed";
  command?: string;
  // Whether the plan's url answers right now, whoever started it.
  reachable: boolean;
  // The last lines the server printed.
  log: string;
}

export interface Card {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  backend: Backend;
  permissionMode: PermissionMode;
  // Chosen when the thread was made; left out, the CLI's own default.
  model?: string;
  effort?: Effort;
  column: Column;
  // Filed away after its Done automations finished; the board hides it until "Show archived".
  archived?: boolean;
  // Skills a "prompt-matches" automation has already run in this thread, so each runs once.
  promptSkills?: string[];
  // The card whose thread started this one, via the board tools.
  parentId?: string;
  sessionId?: string;
  lastLine?: string;
  costUsd?: number;
  stats?: CardStats;
  turns?: number;
  error?: string;
  pending?: PendingPermission | null;
  // The copilot is a thread too, but it lives in its own window instead of on the board.
  role?: "copilot";
  // A CLI process is open for this thread, so a reply starts right away.
  warm?: boolean;
  // From the thread's own BOARD STATUS line (see lib/status.ts).
  stage?: string;
  remaining?: string;
  // The CLI's guess at your next message after a turn (the SDK's prompt suggestions); the reply box
  // shows it as its placeholder and Tab fills it in. Cleared when you send.
  suggestion?: string;
  // From the thread's weft-review block; replaced each time it sends a new one.
  review?: ReviewPlan;
  // Files the thread has edited (Edit, Write, MultiEdit, NotebookEdit), most recent first, capped
  // (lib/overlap.ts), for the warning when busy cards in one folder edit the same files.
  touchedFiles?: string[];
  // Set on cards picked up from existing Claude Code sessions (see lib/import.ts).
  source?: "claude-code";
  // When the session last changed (its last message), and when its transcript was last read into the thread.
  lastActivity?: number;
  transcriptAt?: number;
  // The session is open in another app (the Claude app or a terminal) right now, so Weft won't write to it.
  openElsewhere?: boolean;
  // When a picked-up session looked active in another app, Weft continued it as a copy of this one.
  forkedFrom?: string;
  // When Weft last finished a turn on this card, to tell its own session writes from other apps'.
  lastWeftTurn?: number;
  // Starred: filed in the library (lib/library.ts) as this item. A starred card is never auto-archived.
  libraryId?: string;
  // The library recipe this card was run from.
  recipeId?: string;
  // The card's thumbnail (lib/card-pictures.ts): its latest picture, and how many images its thread holds.
  thumb?: string;
  pictures?: number;
  // Haiku's emoji for the card, shown in place of a thumbnail until it has one.
  emoji?: string;
  // Who last named the card: you (typed or renamed it) or Weft's retitle after its first turn (lib/retitle.ts).
  // Either way, Claude Code's own session title no longer replaces it.
  titleBy?: "user" | "auto";
  // Messages to send at a set time (lib/schedule.ts), soonest first; lib/scheduler.ts sends them.
  scheduled?: ScheduledMessage[];
  createdAt: number;
  updatedAt: number;
}

export type ThreadItem =
  | { kind: "user"; text: string; at: number }
  | { kind: "assistant"; text: string; at: number }
  | {
      kind: "tool";
      id: string;
      name: string;
      summary: string;
      // What the call did, from format.ts toolAction (missing on threads saved before it existed).
      action?: string;
      at: number;
      result?: string;
      // URLs of images the tool returned, like a screenshot.
      images?: string[];
      isError?: boolean;
    }
  | {
      kind: "permission";
      id: string;
      toolName: string;
      title: string;
      decision?: "allow" | "deny";
      // The user's answers, when the agent asked questions.
      answer?: string;
      at: number;
    }
  | { kind: "result"; text: string; costUsd?: number; isError: boolean; at: number };

export interface Project {
  path: string;
  lastUsedAt: number;
}

// When an automation runs its skill: as a thread starts, when you move a card to Review or Done, or
// when a prompt you send matches the rule's pattern.
export type AutomationTrigger = "start" | "review" | "done" | "prompt-matches";

export const AUTOMATION_TRIGGERS: { id: AutomationTrigger; label: string }[] = [
  { id: "start", label: "a thread starts" },
  { id: "review", label: "you move a card to Review" },
  { id: "done", label: "you move a card to Done" },
  { id: "prompt-matches", label: "a prompt matches" },
];

// "When <on>, run the skill <skill>" (see lib/automations.ts).
export interface Automation {
  id: string;
  on: AutomationTrigger;
  // What follows the slash, e.g. "weft:done" for Weft's own skill or "done" for one in ~/.claude/skills.
  skill: string;
  // Regex source, matched case-insensitively; only the "prompt-matches" trigger reads it.
  pattern?: string;
}

export interface SkillInfo {
  // What follows the slash when running it.
  name: string;
  description: string;
  // weft: ships with Weft (plugin/skills); user: ~/.claude/skills; project: <folder>/.claude/skills.
  source: "weft" | "user" | "project";
}

export interface SettingsView {
  threadPrompt: string;
  defaultThreadPrompt: string;
  // Minutes a thread's CLI stays open with no messages before it closes; 0 keeps it open.
  keepAliveMinutes: number;
  // The mode the new-thread dialog, the API and the copilot's create_card start a card in.
  defaultPermissionMode: PermissionMode;
  automations: Automation[];
  projects: Project[];
}

// The library (lib/library.ts): starred cards, kept as a recipe to run again, a to-do page, or a note.
export type LibraryKind = "recipe" | "todo" | "note";
// "mine" is yours everywhere (like ~/.claude); "project" belongs to one folder.
export type LibraryScope = "mine" | "project";

export const LIBRARY_KINDS: { id: LibraryKind; label: string; plural: string; icon: string }[] = [
  { id: "recipe", label: "Recipe", plural: "Recipes", icon: "↻" },
  { id: "todo", label: "To-do", plural: "To do", icon: "☑" },
  { id: "note", label: "Note", plural: "Notes", icon: "✎" },
];

export interface RecipeBlank {
  name: string;
  // What to put there, e.g. "investors? press? partners?".
  hint?: string;
}

export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  scope: LibraryScope;
  title: string;
  // The project folder: where a project item belongs, and where a recipe runs by default.
  folder: string;
  // The card it was starred from.
  cardId?: string;
  // To-dos and notes: the page was saved (index.html in the item's folder). link is the page the card
  // showed when it was a live site rather than a file.
  page?: boolean;
  link?: string;
  // To-dos: how many checkboxes the page has, and which ones (by position) you ticked.
  steps?: number;
  ticked?: number[];
  // Recipes: the skill it's saved as, its prompt with {blank}s, and what a run makes.
  skill?: string;
  skillPath?: string;
  prompt?: string;
  description?: string;
  blanks?: RecipeBlank[];
  makes?: string[];
  createdAt: number;
  updatedAt: number;
}

export type LoginState ="running" | "terminal" | "done" | "failed" | "cancelled";

// A CLI login in progress (or just finished), shown to the user in a pop-up.
export interface LoginView {
  backend: Backend;
  state: LoginState;
  // The CLI's output so far, ANSI codes stripped, last few KB only.
  output: string;
  // The last https URL the CLI printed, if any (the login page).
  url?: string;
  startedAt: number;
}

export interface CliStatus {
  loggedIn: boolean;
  email?: string;
  error?: string;
}

export type BoardEvent =
  | { type: "card"; card: Card }
  | { type: "card_deleted"; id: string }
  // Appends when index === thread length, otherwise replaces the item at index.
  | { type: "thread"; cardId: string; item: ThreadItem; index: number }
  // Streaming text of the assistant message in progress; cleared by the next assistant item.
  | { type: "delta"; cardId: string; text: string }
  | { type: "login"; login: LoginView }
  | { type: "projects"; projects: Project[] }
  // Something in the library changed; the rail reloads.
  | { type: "library" };

// A folder the new-thread picker offers: a recent project, a git repo found on disk, or both.
export interface LocalRepo {
  path: string;
  name: string;
  git: boolean;
  branch?: string;
  // "owner/name" when origin is on GitHub.
  github?: string;
  // When the repo last changed (ms), and when it was last used for a card, if it's a recent project.
  activity: number;
  recentAt?: number;
}

export interface GithubRepo {
  fullName: string;
  description?: string;
  private: boolean;
  pushedAt: number;
  // Set when it's already cloned on this machine.
  localPath?: string;
}
