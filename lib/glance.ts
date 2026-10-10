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

// The splash screen's art (electron/splash.html), reused so a new card opens on the same scene.
const ASSETS = process.env.WEFT_ASSETS_DIR ?? path.join(process.cwd(), "electron", "assets");
const asset = (name: string) => encodeURI(`file://${path.join(ASSETS, name)}`);

// Shown the moment a card's first turn starts, before any model has written anything: the splash scene,
// with the card's title and ask where the splash shows its loading status.
export function starterPage(title: string, ask: string, now = new Date()) {
  return splashPage({ title, note: `Started ${now.toTimeString().slice(0, 5)}`, ask, status: "Reading the code and planning…" });
}

// Beside the New thread dialog while you write the prompt.
export function newThreadPage() {
  return splashPage({ title: "New thread", note: "A board for your AI", status: "Waiting for your prompt…" });
}

function splashPage({ title, note, ask, status }: { title: string; note: string; ask?: string; status: string }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>
html,body{height:100%;margin:0}
body{--ink:#f4efe6;--muted:#d9d0c3;--faint:#b9afa2;--line:rgb(255 250 240/.2);--accent:#d9774b;--accent2:#8f97d6;
background:#1a1520;color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;
-webkit-font-smoothing:antialiased;display:flex;justify-content:center;padding-top:8vh;box-sizing:border-box;overflow:hidden;position:relative}
body::before{content:"";position:absolute;inset:0;background:url("${asset("splash-speeder.jpg")}") center 62%/cover no-repeat;animation:push 24s ease-out both}
body::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgb(10 8 20/.6) 0%,rgb(10 8 20/.2) 45%,transparent 60%,rgb(10 8 12/.5) 100%),radial-gradient(ellipse 90% 80% at 50% 50%,transparent 55%,rgb(0 0 0/.45))}
main{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;max-width:440px;width:100%;padding:0 22px;box-sizing:border-box}
.mark{position:relative;width:96px;height:96px;animation:rise .7s cubic-bezier(.2,.8,.2,1) both}
.mark::before{content:"";position:absolute;inset:-30%;border-radius:50%;background:radial-gradient(closest-side,rgb(255 214 160/.28),transparent);filter:blur(6px)}
.mark img{position:relative;width:100%;height:100%;filter:drop-shadow(0 14px 18px rgb(0 0 0/.45));animation:float 6s ease-in-out infinite alternate}
h1{margin:6px 0 0;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-.02em;background:linear-gradient(100deg,var(--ink) 30%,var(--accent) 60%,var(--accent2));background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:rise .7s .1s cubic-bezier(.2,.8,.2,1) both,sheen 6s ease-in-out infinite alternate}
.time{margin:-6px 0 0;color:var(--muted);font:500 11.5px/1.6 ui-monospace,"SF Mono",Menlo,monospace;animation:rise .7s .2s cubic-bezier(.2,.8,.2,1) both}
.ask{max-height:30vh;overflow:auto;text-align:left;white-space:pre-wrap;color:var(--ink);background:rgb(20 14 24/.55);backdrop-filter:blur(10px);border:.5px solid var(--line);border-radius:10px;padding:10px 13px;font-size:13px;animation:rise .7s .3s cubic-bezier(.2,.8,.2,1) both}
.thread{width:160px;height:3px;margin-top:8px;border-radius:3px;background:var(--line);overflow:hidden;position:relative}
.thread::after{content:"";position:absolute;inset:0;width:45%;border-radius:3px;background:linear-gradient(90deg,transparent,var(--accent),var(--accent2));animation:weave 1.3s ease-in-out infinite}
.status{color:var(--faint);font-size:12.5px}
@keyframes weave{0%{transform:translateX(-100%)}100%{transform:translateX(230%)}}
@keyframes rise{from{opacity:0;transform:translateY(10px) scale(.96)}}
@keyframes float{to{transform:translateY(-6px)}}
@keyframes sheen{to{background-position:100% 0}}
@keyframes push{from{transform:scale(1.08)}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important}}
</style></head><body><main>
<div class="mark"><img src="${asset("emblem.png")}" alt="" onerror="this.style.visibility='hidden'"></div>
<h1>${escape(title)}</h1>
<div class="time">${escape(note)}</div>
${ask === undefined ? "" : `<div class="ask">${escape(clip(ask, MAX_ASK_CHARS))}</div>`}
<div class="thread" aria-hidden="true"></div>
<div class="status">${escape(status)}</div>
</main></body></html>`;
}

function write(cardId: string, html: string) {
  fs.mkdirSync(DIR, { recursive: true });
  const file = glanceFile(cardId);
  fs.writeFileSync(file, html);
  return file;
}

// The New thread dialog's page, as a url the browser pane can load.
export function newThreadUrl() {
  return `file://${write("new-thread", newThreadPage())}`;
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
