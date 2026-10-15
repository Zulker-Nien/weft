import type { SubagentModel } from "./subagents";
import type { SecretAsk } from "./vault-view";

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
export type Backend = "claude" | "puku" | "codex";
export const BACKEND_LABELS: Record<Backend, string> = { claude: "Claude Code", puku: "puku-cli", codex: "Codex" };
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

export function permissionOptions(backend: Backend) {
  if (backend !== "codex") return MODE_OPTIONS.filter((m) => backend === "claude" || m.id !== "bypassPermissions");
  return [
    { id: "bypassPermissions", label: "Full access", hint: "Runs commands and writes outside the project without approval" },
    { id: "auto", label: "Auto review", hint: "Codex reviews command approvals inside the project" },
    { id: "acceptEdits", label: "Workspace write", hint: "Can edit this project; Codex commands stay sandboxed" },
    { id: "default", label: "Read only", hint: "Can inspect files without changing them" },
  ] satisfies { id: PermissionMode; label: string; hint: string }[];
}

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
  // preview: a mockup or code snippet for the option, shown in the browser pane while it's highlighted.
  options: { label: string; description?: string; preview?: string }[];
}

// What goes back with a question's answers: notes on a pick (and the preview it showed), keyed by question,
// or, instead of answers, a message to talk it over ("Chat about this").
export interface QuestionReply {
  annotations?: Record<string, { notes?: string; preview?: string }>;
  chat?: string;
}

export interface PendingPermission {
  id: string;
  toolName: string;
  title: string;
  input: Record<string, unknown>;
  // Set when the agent asked questions instead of asking to use a tool.
  questions?: Question[];
  // A folder outside the card's project that a question names, found on the server (lib/read-scope.ts
  // stats the disk, so the client can't run it); the form offers "Read from <token>" for it.
  readScope?: { directory: string; token: string };
  // The page with the options' previews (lib/question-preview.ts); open it at #<question>-<option>.
  previewUrl?: string;
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
  // The model that cost the most last turn (a subagent's, sometimes).
  model?: string;
  // The thread's own model and effort, from its CLI's init (the header's chip; lib/cli-defaults.ts).
  runsOn?: { model: string; effort?: Effort };
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
  // Sent while a restart waited for the running threads (lib/restart-when-idle.ts): it goes out once Weft is back.
  afterRestart?: boolean;
  // Sent while the thread was mid-turn (a page's link, a failed commit's note): it goes out as that turn ends.
  afterTurn?: boolean;
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
  // The model's and effort's value before a Done move patched them for the /weft:done turn
  // (app/api/cards/[id] moveCard). Cleared by restoreDoneOverride once that turn ends.
  preDoneModel?: string;
  preDoneEffort?: Effort;
  column: Column;
  // When the card last moved to another column; the command palette opens on the latest moves.
  columnAt?: number;
  // Filed away after its Done automations finished; the board hides it until "Show archived".
  archived?: boolean;
  // Running its /done (or Done's automations) and archived when that ends: the board shows it in Done meanwhile.
  wrappingUp?: boolean;
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
  // Set when the thread's last turn hit the plan's rate limit, so the card menu and banner can
  // offer a one-click "Run on <other>" escape. Cleared by switchBackend on a successful switch.
  rateLimitHit?: boolean;
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
  // Top-level symbols (or whole files) the thread edited and hasn't committed, most recent first, capped:
  // "/abs/Board.tsx#CommandPalette", "/abs/a.css#*" (lib/claims.ts). Dropped at Done, archive and commit.
  claims?: string[];
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
  // The card's thumbnail (lib/card-pictures.ts): its latest picture, and how many images its thread holds.
  thumb?: string;
  pictures?: number;
  // Haiku's emoji for the card, shown in place of a thumbnail until it has one.
  emoji?: string;
  // Who last named the card: you (typed or renamed it) or Weft's retitle after its first turn (lib/retitle.ts).
  // Either way, Claude Code's own session title no longer replaces it.
  titleBy?: "user" | "auto";
  // ★: worth keeping. A starred card is never auto-archived.
  starred?: boolean;
  // Directories the user has approved this thread to read from, beyond cwd (the card's project folder).
  // Stored on the card so a resumed session keeps the read scope; passed to the SDK as
  // additionalDirectories. A run-time `/add-dir` slash command isn't enough on its own — the path
  // has to be a subdirectory of cwd or another already-granted directory at session launch.
  readScope?: string[];
  // Short labels (lib/tags.ts), the same rules as GitHub labels so they sync with an issue's. Weft's
  // retitle picks them after a turn (tagsBy "auto") until you edit them (tagsBy "user").
  tags?: string[];
  tagsBy?: "user" | "auto";
  // The GitHub issue this card came from (lib/github-issues.ts).
  issue?: CardIssue;
  // Messages to send at a set time (lib/schedule.ts), soonest first; lib/scheduler.ts sends them.
  scheduled?: ScheduledMessage[];
  // A turn the app closed in the middle of; lib/resume.ts carries it on after the restart. `resumes` counts the
  // carry-on turns in a row (your own message resets it), so a turn that keeps getting cut off stops after a few.
  interrupted?: boolean;
  resumes?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CardIssue {
  // "owner/name"
  repo: string;
  number: number;
  url: string;
  state: "open" | "closed";
  // The issue's updated_at when Weft last read it, to tell its edits from ours.
  updatedAt: string;
}

export type ThreadItem =
  // id is the uuid Weft sent the prompt to the CLI with, so ↑ can rewind its turn (lib/edit-last.ts).
  // page is what the card's browser pane showed as it was sent (lib/pane-page.ts), for the glance rail.
  | { kind: "user"; text: string; at: number; id?: string; page?: string }
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
      // Set when a long result was left out of the item (lib/cloud-sync-types.ts TOOL_RESULT_INLINE_MAX):
      // its length, so the row can say how much it holds before it's fetched.
      resultBytes?: number;
      // URLs of images the tool returned, like a screenshot.
      images?: string[];
      isError?: boolean;
      // An mcp__secrets__ask_add call: the thread shows an input for this key in its place (lib/vault-view.ts).
      ask?: SecretAsk;
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
  | { kind: "result"; text: string; costUsd?: number; isError: boolean; at: number }
  // A message you edited with ↑, and the turn it started, folded away when the edit went out.
  | { kind: "edited"; items: ThreadItem[]; at: number }
  // A "!" command you ran from the reply box (lib/shell.ts). ms is set once it ends; sent once its
  // output went to Claude with your next message.
  | {
      kind: "shell";
      command: string;
      at: number;
      output?: string;
      exitCode?: number | null;
      ms?: number;
      timedOut?: boolean;
      sent?: boolean;
    };

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
  // What new threads start on; puku-cli is the escape hatch when Claude hits a plan limit.
  defaultBackend: Backend;
  automations: Automation[];
  // /weft:done runs `git push` after a clean commit (plugin/skills/done/push.sh).
  pushOnDone: boolean;
  // What board threads' subagents run on; "choose" lets each thread pick (lib/subagents.ts).
  subagentModel: SubagentModel;
  // The model and effort /weft:done runs on; "" means use the card's own (lib/automations.ts doneOverrides).
  doneModel: string;
  doneEffort: Effort | "";
  projects: Project[];
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
  // Why Weft's Puku trial didn't cover this login (lib/puku-trial.ts), for the pop-up to say.
  trial?: LoginTrial;
}

// signed-out: no Weft account to give a trial token to; unavailable: the trial server said no;
// failed: a thread on a fresh trial token still couldn't sign in.
export interface LoginTrial {
  reason: "signed-out" | "unavailable" | "failed";
  message: string;
}

export interface CliStatus {
  loggedIn: boolean;
  email?: string;
  error?: string;
}

export type BoardEvent =
  | { type: "card"; card: Card }
  | { type: "card_deleted"; id: string }
  // Appends when index === thread length, otherwise replaces the item at index; truncate drops what follows it.
  | { type: "thread"; cardId: string; item: ThreadItem; index: number; truncate?: boolean }
  // Streaming text of the assistant message in progress; cleared by the next assistant item.
  | { type: "delta"; cardId: string; text: string }
  | { type: "login"; login: LoginView }
  | { type: "projects"; projects: Project[] }
  // You signed in or out of your Weft account (lib/account.ts).
  | { type: "account" }
  // A restart was armed, cancelled, or the turns it waits on changed (lib/restart-when-idle.ts).
  | { type: "restart"; restart: RestartStatus };

// Restart when idle (lib/restart-when-idle.ts): no new turn starts, and Weft restarts when the last one ends.
export interface RestartStatus {
  armed: boolean;
  // What happens once idle: a plain relaunch, or installing a downloaded update.
  then?: "relaunch" | "update";
  // The turns it waits on: running now, or with queued messages still to run.
  waiting: { id: string; title: string }[];
  // Why the restart didn't happen, when it couldn't (it's disarmed then).
  error?: string;
}

// Your Weft account (lib/account.ts): optional, for cloud features.
export type AccountProvider = "github" | "google";

export interface AccountUser {
  id: string;
  email: string | null;
  name: string | null;
  avatar: string | null;
  // "github", "google" or "email".
  provider: string | null;
}

export interface AccountView {
  // False until the app has a Supabase key; Settings then says sign-in isn't set up yet.
  configured: boolean;
  user: AccountUser | null;
}

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
