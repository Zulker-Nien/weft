import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { openInPane, paneUrl } from "./browser-tools";
import { DATA_DIR } from "./store";

// The pane is never empty or stale: a card with no page gets a starter page when its turn starts, and a
// turn that showed nothing gets a teammate's update page written by Haiku after it ends. Haiku with a
// bare CLI (no settings, MCP or tools) measured ~8-15s, steadier than puku-ai-2.8 (docs/ROADMAP.md).
const MODEL = "haiku";
const MAX_REPLY_CHARS = 12_000;
const MAX_ASK_CHARS = 2_000;

const DIR = path.join(DATA_DIR, "glance");

export function glanceFile(cardId: string) {
  return path.join(DIR, `${cardId}.html`);
}

export function glancePrompt(ask: string, reply: string) {
  return `You're a teammate on this build (product manager, engineer or designer: pick whichever lens fits this turn best) writing a one-screen update page for the person driving it. Answer: How's it going? What did we just do, and why does it matter? What should we do next? Have a point of view, be specific, make it visual (a progress bar, a before→after, a mini diagram, a next-step you'd bet on). Not a changelog. Only claim what the reply supports. One self-contained HTML file, inline CSS, no JS, fits ~400px wide. Output only HTML.

The user asked: ${JSON.stringify(clip(ask, MAX_ASK_CHARS))}
The agent replied:
${clip(reply, MAX_REPLY_CHARS)}`;
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// The HTML in a model's answer, without a code fence or chat around it; undefined if there's none.
export function extractHtml(text: string): string | undefined {
  const start = text.search(/<!doctype html|<html[\s>]/i);
  if (start < 0) return undefined;
  const end = text.toLowerCase().lastIndexOf("</html>");
  return end > start ? text.slice(start, end + "</html>".length) : text.slice(start);
}

// After a turn: write a page unless the thread already showed one, or the pane shows a live app.
// No pane url means no desktop shell to show it in.
export function shouldWriteGlance(turn: { openedPane: boolean; isError: boolean; stopped: boolean; paneUrl?: string }) {
  if (turn.openedPane || turn.isError || turn.stopped || turn.paneUrl === undefined) return false;
  return !/^https?:/i.test(turn.paneUrl);
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// Shown the moment a card's first turn starts, before any model has written anything.
export function starterPage(title: string, ask: string, now = new Date()) {
  const time = now.toTimeString().slice(0, 5);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>
body{margin:0;font:15px/1.55 -apple-system,system-ui,sans-serif;background:#0f1115;color:#e6e8ec;padding:28px 22px}
.tag{display:inline-block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7ee787;border:1px solid #2f5d3a;border-radius:999px;padding:2px 10px}
h1{font-size:21px;line-height:1.3;margin:14px 0 6px}.muted{color:#8a8f98;font-size:13px}
.ask{background:#171a21;border:1px solid #262a33;border-left:3px solid #8ab4ff;border-radius:8px;padding:12px 14px;margin:18px 0;white-space:pre-wrap}
.steps{display:flex;gap:8px;margin-top:22px}.steps div{flex:1;background:#171a21;border:1px solid #262a33;border-radius:8px;padding:10px;font-size:13px}
.steps b{display:block;color:#8ab4ff;font-size:12px;margin-bottom:2px}.on{border-color:#7ee787!important}
.pulse{display:inline-block;width:8px;height:8px;border-radius:50%;background:#7ee787;margin-right:6px;animation:p 1.4s infinite}
@keyframes p{50%{opacity:.25}}</style></head><body>
<span class="tag"><span class="pulse"></span>Working on it</span>
<h1>${escape(title)}</h1><div class="muted">Started ${time}</div>
<div class="ask">${escape(clip(ask, MAX_ASK_CHARS))}</div>
<div class="steps"><div class="on"><b>Now</b>Reading the code and planning</div><div><b>Next</b>The thread shows its work here</div><div><b>After</b>An update page: how it's going and what's next</div></div>
</body></html>`;
}

function write(cardId: string, html: string) {
  fs.mkdirSync(DIR, { recursive: true });
  const file = glanceFile(cardId);
  fs.writeFileSync(file, html);
  return file;
}

// Fire and forget from the start-a-card path: a file write and one local request, nothing awaited.
export async function showStarter(cardId: string, title: string, ask: string) {
  if ((await paneUrl(cardId)) !== "") return;
  await openInPane(`file://${write(cardId, starterPage(title, ask))}`, cardId);
}

// After a turn ends, off the reply's path. `isCurrent` drops the page if a newer turn started meanwhile.
export async function glanceAfterTurn(
  cardId: string,
  turn: { ask: string; reply: string; openedPane: boolean; isError: boolean; stopped: boolean },
  isCurrent: () => boolean,
) {
  if (!turn.reply.trim() || !shouldWriteGlance({ ...turn, paneUrl: await paneUrl(cardId) })) return;
  await writeGlance(cardId, turn.ask, turn.reply, isCurrent);
}

async function writeGlance(cardId: string, ask: string, reply: string, isCurrent: () => boolean) {
  const html = extractHtml(await complete(glancePrompt(ask, reply)));
  if (!html || !isCurrent()) return;
  await openInPane(`file://${write(cardId, html)}`, cardId);
}

// One plain Haiku completion through a CLI with nothing loaded: no settings, hooks, MCP, tools or session file.
async function complete(prompt: string) {
  let text = "";
  for await (const msg of query({
    prompt,
    options: { model: MODEL, tools: [], settingSources: [], strictMcpConfig: true, persistSession: false, maxTurns: 1 },
  })) {
    if (msg.type === "result" && msg.subtype === "success") text = msg.result;
  }
  return text;
}
