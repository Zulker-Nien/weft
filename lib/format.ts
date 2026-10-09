import type { Card } from "./types";

// Display helpers shared by the server and the board UI.

// A thread is live while a turn runs or a permission request waits; a card in Needs you
// with a question (not a permission request) can be replied to and moved like any other.
export function isLive(card: Card) {
  return card.column === "running" || Boolean(card.pending);
}

export function shortToolName(name: string) {
  return name.startsWith("mcp__") ? name.split("__").slice(1).join(" ") : name;
}

export function folderName(cwd: string) {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

// "/me/app/.claude/worktrees/eager-x/src" -> "/me/app": the repo a Claude Code worktree folder belongs to,
// read off the path alone, so it works for worktrees that have since been deleted.
export function worktreeParent(cwd: string) {
  const match = /^(.+?)\/\.claude\/worktrees\/[^/]+(?:\/|$)/.exec(cwd);
  return match ? match[1] : undefined;
}

export function formatCost(usd?: number) {
  if (!usd) return null;
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

export function timeAgo(at: number, now: number) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// What a tool call did, as a kind ("command", "read", "click"...), for the one-line summary of a run
// of tool calls. Browser tools from every source (Weft's pane, Claude's browser, Chrome, computer
// use) share one vocabulary, read from the tool name or its `action` input.
export function toolAction(name: string, input: Record<string, unknown> = {}): string {
  switch (name) {
    case "Bash":
    case "BashOutput":
    case "KillShell":
      return "command";
    case "Read":
      return "read";
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return "edit";
    case "Write":
      return "write";
    case "Grep":
    case "Glob":
    case "LS":
      return "search";
    case "WebSearch":
      return "web";
    case "WebFetch":
      return "fetch";
    case "Task":
    case "Agent":
      return "agent";
    case "TodoWrite":
    case "TaskCreate":
    case "TaskUpdate":
      return "plan";
    case "AskUserQuestion":
      return "question";
    case "Skill":
      return "skill";
    case "ToolSearch":
      return "tools";
    case "SendMessage":
      return "message";
  }
  if (!name.startsWith("mcp__")) return `use:${name}`;
  const [, server = "", tool = ""] = name.split("__");
  if (/browser|chrome|computer|playwright|puppeteer|preview/i.test(server)) {
    const action = typeof input.action === "string" ? input.action : tool;
    if (/navigate|open_url|preview_start|tabs_create/.test(action)) return "open";
    if (/screenshot|zoom/.test(action)) return "screenshot";
    if (/click/.test(action)) return "click";
    if (/^(type|type_text|form_input)$/.test(action)) return "type";
    if (action === "key") return "key";
    if (/scroll/.test(action)) return "scroll";
    if (/resize/.test(action)) return "resize";
    if (/read_page|get_page_text|find/.test(action)) return "look";
    return "browser";
  }
  return `mcp:${server}__${tool}`;
}

const count = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", String(n)));

const PHRASES: Record<string, (n: number) => string> = {
  command: (n) => count(n, "ran a command", "ran # commands"),
  read: (n) => count(n, "read a file", "read # files"),
  edit: (n) => count(n, "edited a file", "edited # files"),
  write: (n) => count(n, "wrote a file", "wrote # files"),
  search: (n) => count(n, "searched the code", "searched # times"),
  web: (n) => count(n, "searched the web", "searched the web # times"),
  fetch: (n) => count(n, "fetched a page", "fetched # pages"),
  agent: (n) => count(n, "ran an agent", "ran # agents"),
  plan: () => "updated the plan",
  question: () => "asked you",
  skill: (n) => count(n, "loaded a skill", "loaded # skills"),
  tools: () => "loaded tools",
  message: (n) => count(n, "sent a message", "sent # messages"),
  open: (n) => count(n, "opened a page", "opened # pages"),
  screenshot: (n) => count(n, "took a screenshot", "took # screenshots"),
  click: (n) => count(n, "clicked", "clicked # times"),
  type: (n) => count(n, "typed", "typed # times"),
  key: (n) => count(n, "pressed a key", "pressed # keys"),
  scroll: (n) => count(n, "scrolled", "scrolled # times"),
  resize: () => "resized the browser",
  look: (n) => count(n, "read the page", "read the page # times"),
  browser: (n) => count(n, "used the browser", "used the browser # times"),
};

// File tools count the files they touched, not their calls: three edits to one file "edited a file".
const BY_TARGET = new Set(["read", "edit", "write"]);

// A server name readable enough to show, or undefined for the ids claude.ai connectors get.
function serverLabel(server: string) {
  return /^[0-9a-f]{8}-/.test(server) ? undefined : server.replace(/^plugin_[^_]+_/, "").replace(/_/g, " ");
}

function phrase(kind: string, n: number) {
  if (PHRASES[kind]) return PHRASES[kind](n);
  const [scope, rest = ""] = kind.split(":");
  const [server, tool] = rest.split("__");
  const label = scope === "mcp" ? (serverLabel(server) ?? tool ?? server) : rest;
  return count(n, `used ${label}`, `used ${label} # times`);
}

// "Pressed a key, resized the browser, opened 2 pages +2": what a run of tool calls did, in order of
// first appearance, with how many other kinds of thing it did.
export function describeToolRun(calls: { action: string; target?: string }[], show = 3) {
  const kinds = new Map<string, Set<string>>();
  calls.forEach((call, i) => {
    const targets = kinds.get(call.action) ?? new Set<string>();
    targets.add(BY_TARGET.has(call.action) && call.target ? call.target : String(i));
    kinds.set(call.action, targets);
  });
  const phrases = [...kinds].map(([kind, targets]) => phrase(kind, targets.size));
  const text = phrases.slice(0, show).join(", ");
  return {
    text: text.charAt(0).toUpperCase() + text.slice(1),
    more: Math.max(0, phrases.length - show),
  };
}

// A card title from its prompt: the first line with words in it, without Markdown markup or pasted
// media. A prompt that's only media is named after its first file.
export function titleFromPrompt(prompt: string, max = 60) {
  const clean = (line: string) =>
    line
      .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, "")
      .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
      .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
      .replace(/(\*\*|__|~~|`)/g, "")
      .replace(/(^|\s)[*_](\S)/g, "$1$2")
      .replace(/(\S)[*_](?=\s|$)/g, "$1")
      .trim();
  const line = prompt
    .split("\n")
    .filter((l) => !/^\s*(```|~~~|---+\s*$)/.test(l))
    .map(clean)
    .find(Boolean);
  if (line) return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
  const media = /!\[([^\]\n]*)\]/.exec(prompt)?.[1]?.trim();
  return media ? `Look at ${media}` : "New thread";
}

export function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// "6am" or "fri 2pm", from unix seconds.
export function formatReset(resetsAt: number, now = Date.now()) {
  const d = new Date(resetsAt * 1000);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric" }).replace(" ", "").toLowerCase();
  const sameDay = d.getTime() - now < 20 * 3600_000;
  return sameDay ? time : `${d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase()} ${time}`;
}
