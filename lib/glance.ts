import fs from "node:fs";
import path from "node:path";
import { saveAttachmentData } from "./attachments";
import { openInPane, paneThumb, paneUrl } from "./browser-tools";
import { emojiPrompt, parseEmoji } from "./card-pictures";
import { complete } from "./haiku";
import { listLibrary } from "./library";
import { parseTitle, shouldRetitle, titleEmoji, titlePrompt } from "./retitle";
import { DATA_DIR, decorateCard, getCard } from "./store";
import type { LibraryItem } from "./types";

// The pane is never empty or stale: a card with no page gets a starter page when its turn starts, and a
// turn that showed nothing gets a teammate's update page written by Haiku (lib/haiku.ts) after it ends.
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

// Shown the moment a turn starts on a card whose pane is blank, before any model has written anything:
// a dimmed, slowly drifting scene behind the card's title, your ask (pasted images as thumbnails) and a
// running clock. The scene is the card's own, picked from the backdrops by its id.
export function starterPage(title: string, ask: string, now = new Date(), cardId = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>
html,body{height:100%;margin:0}
body{background:#120d10;color:#f6efe6;font:14px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;
-webkit-font-smoothing:antialiased;overflow:hidden;position:relative}
body::before{content:"";position:absolute;inset:-4%;background:url("${asset(backdropFor(cardId))}") center 70%/cover no-repeat;
filter:saturate(.75) brightness(.55);animation:drift 30s ease-in-out infinite alternate}
body::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgb(8 6 12/.85),rgb(8 6 12/.25) 55%,rgb(8 6 12/.7))}
main{position:relative;z-index:1;padding:9vh 8% 0;max-width:560px;animation:rise .8s cubic-bezier(.2,.8,.2,1) both}
.k{font:500 10.5px ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.14em;color:#d9a27e;text-transform:uppercase}
h1{margin:8px 0 0;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-.015em}
.ask{max-height:40vh;overflow:auto;margin-top:18px;white-space:pre-wrap;color:#cfc5b8;font-size:13px;border-left:2px solid rgb(217 162 126/.6);padding-left:12px}
.ask img{display:block;max-width:220px;max-height:160px;border-radius:6px;margin:2px 0 8px;opacity:.92}
.clock{position:absolute;left:8%;bottom:5vh;z-index:1;font:500 12px ui-monospace,"SF Mono",Menlo,monospace;color:#e8dccd}
@keyframes drift{to{transform:translateX(-3%) scale(1.04)}}
@keyframes rise{from{opacity:0;transform:translateY(8px)}}
@media (prefers-reduced-motion:reduce){*,*::before{animation:none!important}}
</style></head><body><main>
<div class="k">Working · since ${now.toTimeString().slice(0, 5)}</div>
<h1>${escape(title)}</h1>
<div class="ask">${askHtml(clip(ask, MAX_ASK_CHARS))}</div>
</main>
<div class="clock" id="clock">00:00</div>
<script>
const start = ${now.getTime()};
const pad = (n) => String(n).padStart(2, "0");
const tick = () => {
  const s = Math.max(0, Math.floor((Date.now() - start) / 1000));
  document.getElementById("clock").textContent = (s >= 3600 ? Math.floor(s / 3600) + ":" : "") + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60);
};
tick();
setInterval(tick, 1000);
</script></body></html>`;
}

// The scenes a working card can get: electron/assets/backdrop-*.jpg, plus the splash's own.
function backdrops() {
  try {
    const extra = fs.readdirSync(ASSETS).filter((f) => /^backdrop-.+\.(jpe?g|png|webp)$/i.test(f)).sort();
    return ["splash-speeder.jpg", ...extra];
  } catch {
    return ["splash-speeder.jpg"];
  }
}

// A card keeps one scene for its whole life; different cards spread across them.
export function backdropFor(cardId: string, names = backdrops()) {
  let hash = 0;
  for (const ch of cardId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return names[hash % names.length];
}

// Your ask, escaped, with pasted images (`![name](/abs/path.png)`) shown as thumbnails.
function askHtml(ask: string) {
  return escape(ask).replace(/\n*!\[([^\]]*)\]\((\/[^)]+)\)\n*/g, (_, alt: string, file: string) => `<img src="${encodeURI(`file://${file}`)}" alt="${alt}">`);
}

// A recipe the New thread page offers (lib/library.ts).
export type RecipeLink = Pick<LibraryItem, "id" | "title" | "blanks">;

// Beside the New thread dialog while you write the prompt; the folder's recipes and yours sit under it, and
// picking one fills the dialog in (weft://recipe/<id>, handled in electron/main.cjs).
export function newThreadPage(recipes: RecipeLink[] = []) {
  const list = recipes.slice(0, 6);
  const extra = list.length
    ? `<nav class="recipes"><div class="or">or start from a recipe</div>${list
        .map((r) => `<a href="weft://recipe/${encodeURIComponent(r.id)}">↻ ${escape(r.title)}${r.blanks?.length ? ` <span>${escape(r.blanks.map((b) => `{${b.name}}`).join(" "))}</span>` : ""}</a>`)
        .join("")}</nav>`
    : "";
  return splashPage({ title: "New thread", note: "A board for your AI", status: "Waiting for your prompt…", extra });
}

function splashPage({ title, note, ask, status, extra = "" }: { title: string; note: string; ask?: string; status: string; extra?: string }) {
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
.recipes{display:flex;flex-direction:column;gap:6px;width:100%;margin-top:14px;animation:rise .7s .4s cubic-bezier(.2,.8,.2,1) both}
.recipes .or{color:var(--faint);font-size:11.5px;letter-spacing:.06em;text-transform:uppercase}
.recipes a{display:block;text-align:left;color:var(--ink);text-decoration:none;background:rgb(20 14 24/.55);backdrop-filter:blur(10px);border:.5px solid var(--line);border-radius:9px;padding:8px 12px;font-size:13px}
.recipes a:hover{border-color:var(--accent)}.recipes span{color:var(--faint);font:11.5px ui-monospace,Menlo,monospace}
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
${extra}
</main></body></html>`;
}

function write(cardId: string, html: string) {
  fs.mkdirSync(DIR, { recursive: true });
  const file = glanceFile(cardId);
  fs.writeFileSync(file, html);
  return file;
}

// The New thread dialog's page, as a url the browser pane can load, offering the folder's recipes and yours.
export function newThreadUrl(folder?: string | null) {
  const recipes = listLibrary({ folder }).filter((i) => i.kind === "recipe");
  return `file://${write("new-thread", newThreadPage(recipes))}`;
}

// Fire and forget from the start-a-card path: a file write and one local request, nothing awaited.
export async function showStarter(cardId: string, title: string, ask: string) {
  if ((await paneUrl(cardId)) !== "") return;
  await openInPane(`file://${write(cardId, starterPage(title, ask, new Date(), cardId))}`, cardId);
}

// After a turn ends, off the reply's path. `isCurrent` drops the page if a newer turn started meanwhile.
export async function glanceAfterTurn(
  cardId: string,
  turn: { ask: string; reply: string; openedPane: boolean; isError: boolean; stopped: boolean },
  isCurrent: () => boolean,
) {
  if (turn.reply.trim() && shouldWriteGlance({ ...turn, paneUrl: await paneUrl(cardId) })) {
    await writeGlance(cardId, turn.ask, turn.reply, isCurrent).catch(() => {});
  }
  retitleAfterTurn(cardId, turn);
  await pictureAfterTurn(cardId, isCurrent);
}

// A card still named "Image attachment" or by its raw prompt gets a Haiku title with an emoji (lib/retitle.ts),
// and that emoji becomes its tile. Fire and forget; a failed or empty reply leaves the title for the next turn.
function retitleAfterTurn(cardId: string, turn: { ask: string; reply: string }) {
  const card = getCard(cardId);
  if (!card || !shouldRetitle(card) || !turn.reply.trim()) return;
  void complete(titlePrompt(turn.ask, turn.reply))
    .then((reply) => {
      const title = parseTitle(reply);
      const current = getCard(cardId);
      // You may have renamed it while Haiku was thinking.
      if (!title || !current || !shouldRetitle(current)) return;
      const emoji = titleEmoji(title);
      decorateCard(cardId, { title, titleBy: "auto", ...(emoji ? { emoji } : {}) });
    })
    .catch(() => {});
}


// How long a page just opened in the pane gets to paint before it's captured.
const PAINT_MS = 1200;

// After the turn and its update page: the card's pane, captured as its thumbnail, and once per card an
// emoji for its tile (lib/card-pictures.ts). Both off the reply's path and the start-a-card path.
async function pictureAfterTurn(cardId: string, isCurrent: () => boolean) {
  const card = getCard(cardId);
  if (!card) return;
  if (!card.emoji) {
    void complete(emojiPrompt(card.title))
      .then((reply) => {
        const emoji = parseEmoji(reply);
        if (emoji) decorateCard(cardId, { emoji });
      })
      .catch(() => {});
  }
  await new Promise((resolve) => setTimeout(resolve, PAINT_MS));
  if (!isCurrent()) return;
  const jpg = await paneThumb(cardId);
  if (!jpg) return;
  decorateCard(cardId, { thumb: saveAttachmentData(jpg, "pane.jpg", "image/jpeg").url });
}

async function writeGlance(cardId: string, ask: string, reply: string, isCurrent: () => boolean) {
  const html = extractHtml(await complete(glancePrompt(ask, reply)));
  if (!html || !isCurrent()) return;
  await openInPane(`file://${write(cardId, html)}`, cardId);
}
