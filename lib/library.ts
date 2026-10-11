import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
// Not react-dom/server: Next refuses it in an API route's import graph. micromark is the parser under
// react-markdown, and like it, escapes raw HTML.
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { publish } from "./bus";
import { blanksIn } from "./library-view";

// The {blank} helpers are pure, so they live in library-view.ts for the browser too.
export { blanksIn, fillBlanks } from "./library-view";
import { DATA_DIR, getThread, listCards, updateCard } from "./store";
import type { Card, LibraryItem, LibraryKind, LibraryScope, RecipeBlank, ThreadItem } from "./types";

// The library: cards you starred, kept as a recipe (run it again), a to-do (a page of steps to tick off) or a
// note (an answer to keep). Like Claude Code, it has two levels: "mine", yours everywhere, and "project",
// one folder's. To-dos and notes live in ~/.weft/library (mine) and ~/.weft/library/projects/<slug>
// (a project's), the way Claude keeps memory in ~/.claude/projects/<slug>, out of the repo. Each scope
// has an items.json index and a folder per item with its saved page (index.html) and files.
// A recipe is a Claude skill (~/.claude/skills/<name>, or <folder>/.claude/skills/<name>), so it runs
// in plain Claude Code too; its library entry keeps the prompt, blanks and runs.

export const LIBRARY_DIR = path.join(DATA_DIR, "library");
const PROJECTS_DIR = path.join(LIBRARY_DIR, "projects");
const INDEX = "items.json";
// Pages bigger than this aren't worth keeping as a page, and files bigger than this aren't copied.
const MAX_FILE_BYTES = 25 * 1024 * 1024;

// Like Claude Code's ~/.claude/projects/<slug>: the folder path with everything but letters and digits as "-".
export function projectSlug(folder: string) {
  return folder.replace(/[^a-zA-Z0-9]/g, "-");
}

function scopeDir(scope: LibraryScope, folder: string) {
  return scope === "mine" ? LIBRARY_DIR : path.join(PROJECTS_DIR, projectSlug(folder));
}

function readIndex(dir: string): LibraryItem[] {
  try {
    return (JSON.parse(fs.readFileSync(path.join(dir, INDEX), "utf8")) as { items?: LibraryItem[] }).items ?? [];
  } catch {
    return [];
  }
}

function writeIndex(dir: string, items: LibraryItem[]) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, INDEX), JSON.stringify({ items }, null, 2));
}

function projectDirs(): string[] {
  try {
    return fs.readdirSync(PROJECTS_DIR).map((d) => path.join(PROJECTS_DIR, d));
  } catch {
    return [];
  }
}

const newestFirst = (a: LibraryItem, b: LibraryItem) => b.updatedAt - a.updatedAt;

// What the rail shows: yours, plus one project's (folder), or every project's too (all).
export function listLibrary({ folder, all = false }: { folder?: string | null; all?: boolean } = {}): LibraryItem[] {
  const dirs = all ? [LIBRARY_DIR, ...projectDirs()] : [LIBRARY_DIR, ...(folder ? [scopeDir("project", folder)] : [])];
  return dirs.flatMap(readIndex).sort(newestFirst);
}

export function getItem(id: string): LibraryItem | undefined {
  for (const dir of [LIBRARY_DIR, ...projectDirs()]) {
    const item = readIndex(dir).find((i) => i.id === id);
    if (item) return item;
  }
  return undefined;
}

// The item's own folder: its saved page and files.
export function itemDir(item: LibraryItem) {
  return path.join(scopeDir(item.scope, item.folder), item.id);
}

function changed() {
  publish({ type: "library" });
}

export function addItem(input: Omit<LibraryItem, "id" | "createdAt" | "updatedAt">, id: string = randomUUID()): LibraryItem {
  const now = Date.now();
  const item: LibraryItem = { ...input, id, createdAt: now, updatedAt: now };
  const dir = scopeDir(item.scope, item.folder);
  writeIndex(dir, [...readIndex(dir).filter((i) => i.id !== id), item]);
  changed();
  return item;
}

export type LibraryPatch = Partial<Pick<LibraryItem, "title" | "kind" | "scope" | "ticked">>;

// A to-do and a note swap freely; a recipe stays a recipe (it has no page) and the others can't become one.
// Moving between mine and project moves the item's folder, and a recipe's skill with it.
export function updateItem(id: string, patch: LibraryPatch): LibraryItem {
  const item = getItem(id);
  if (!item) throw new Error(`No library item ${id}`);
  if (patch.kind && patch.kind !== item.kind && (patch.kind === "recipe" || item.kind === "recipe")) {
    throw new Error(item.kind === "recipe" ? "A recipe stays a recipe." : "Save the card as a recipe instead.");
  }
  const next: LibraryItem = { ...item, ...definedOnly(patch), updatedAt: Date.now() };
  if (patch.ticked) next.ticked = [...new Set(patch.ticked.filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);

  const from = scopeDir(item.scope, item.folder);
  const to = scopeDir(next.scope, next.folder);
  if (from !== to) {
    if (fs.existsSync(itemDir(item))) {
      fs.mkdirSync(to, { recursive: true });
      fs.renameSync(itemDir(item), path.join(to, item.id));
    }
    if (item.kind === "recipe" && item.skillPath && item.skill) {
      const skillTo = path.join(skillsDir(next.scope, next.folder), item.skill);
      if (fs.existsSync(item.skillPath) && !fs.existsSync(skillTo)) {
        fs.mkdirSync(path.dirname(skillTo), { recursive: true });
        fs.renameSync(item.skillPath, skillTo);
        next.skillPath = skillTo;
      }
    }
    writeIndex(from, readIndex(from).filter((i) => i.id !== id));
    writeIndex(to, [...readIndex(to), next]);
  } else {
    writeIndex(to, readIndex(to).map((i) => (i.id === id ? next : i)));
  }
  changed();
  return next;
}

function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// Takes it out of the library and unstars its card. A recipe's skill goes too, but only if Weft wrote it
// and it still says so: an edited or hand-made skill is yours.
export function removeItem(id: string) {
  const item = getItem(id);
  if (!item) return;
  const dir = scopeDir(item.scope, item.folder);
  writeIndex(dir, readIndex(dir).filter((i) => i.id !== id));
  fs.rmSync(itemDir(item), { recursive: true, force: true });
  if (item.skillPath) {
    const skill = path.join(item.skillPath, "SKILL.md");
    try {
      if (fs.readFileSync(skill, "utf8").includes(SKILL_MARK)) fs.rmSync(item.skillPath, { recursive: true, force: true });
    } catch {}
  }
  for (const card of listCards()) {
    if (card.libraryId === id) updateCard(card.id, { libraryId: undefined });
  }
  changed();
}

// ---- Saving a card's page ----

// A link or src in a page that points at a file on this machine: a relative path (from the page's folder), an
// absolute path, or a file:// URL. Web links, data URLs and anchors aren't.
export function localAsset(ref: string, baseDir: string): string | undefined {
  const raw = ref.trim();
  const fileUrl = /^file:/i.test(raw);
  // Anchors, protocol-relative links, and any other scheme (https:, data:, mailto:, weft:…).
  if (!raw || raw.startsWith("#") || raw.startsWith("//") || (!fileUrl && /^[a-z][a-z0-9+.-]*:/i.test(raw))) return undefined;
  let file: string;
  try {
    const bare = raw.split(/[?#]/)[0] ?? "";
    file = fileUrl ? fileURLToPath(bare) : path.resolve(baseDir, decodeURI(bare));
  } catch {
    return undefined;
  }
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size <= MAX_FILE_BYTES ? file : undefined;
  } catch {
    return undefined;
  }
}

// Copies the local files a page points at (images, styles, screenshots) into files/ beside it and points the
// page at the copies, so the saved page still works once /tmp is cleared.
export function bundlePage(html: string, baseDir: string, outDir: string): string {
  const copied = new Map<string, string>();
  const copy = (ref: string) => {
    const file = localAsset(ref, baseDir);
    if (!file) return ref;
    let rel = copied.get(file);
    if (!rel) {
      rel = `files/${copied.size + 1}-${path.basename(file).replace(/[^\w.-]/g, "_")}`;
      fs.mkdirSync(path.join(outDir, "files"), { recursive: true });
      fs.copyFileSync(file, path.join(outDir, rel));
      copied.set(file, rel);
    }
    return rel;
  };
  return html
    .replace(/\b(src|href|poster)=(["'])(.*?)\2/gi, (_m, attr: string, q: string, ref: string) => `${attr}=${q}${copy(ref)}${q}`)
    .replace(/url\((["']?)([^)"']+)\1\)/gi, (_m, q: string, ref: string) => `url(${q}${copy(ref)}${q})`);
}

// What a page calls itself: its <title>, else its first heading, as plain text; undefined if it has neither.
export function pageTitle(html: string): string | undefined {
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const text = html.match(re)?.[1]
      ?.replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text.slice(0, 120);
  }
  return undefined;
}

export function countCheckboxes(html: string) {
  return (html.match(/<input\b[^>]*type=["']?checkbox/gi) ?? []).length;
}

// The thread's last answer: its final result, else its last message.
export function lastReply(items: ThreadItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!item) continue;
    if ((item.kind === "result" || item.kind === "assistant") && item.text.trim()) return item.text;
  }
  return "";
}

// Lines a board thread adds for Weft itself, which don't belong on a kept page.
function withoutWeftLines(text: string) {
  return text
    .replace(/```weft-review[\s\S]*?```/g, "")
    .replace(/^BOARD STATUS:.*$/gm, "")
    .replace(/^`=-=\[ SESSION STATUS:.*$/gm, "")
    .trim();
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

const PAGE_STYLE = `body{margin:0;background:#f6f1e7;color:#2a2420;font:15px/1.6 -apple-system,system-ui,sans-serif;padding:28px 32px;max-width:760px}
h1{font:600 26px/1.25 Georgia,serif;margin:0 0 4px}h2,h3{font-family:Georgia,serif}
.meta{color:#8a7f74;font-size:12.5px;margin-bottom:20px}
a{color:#b4542f}code{background:#f1e7d6;padding:1px 5px;border-radius:4px;font-size:.88em}
pre{background:#2a2420;color:#f6f1e7;padding:12px 14px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
img{max-width:100%;border-radius:6px}li:has(>input[type=checkbox]){list-style:none;margin-left:-1.3em}
table{border-collapse:collapse}td,th{border:1px solid #e2d8c7;padding:4px 8px}`;

// A page for a card that showed none (or showed a live site): its last answer, as Markdown.
export function replyPage(title: string, reply: string, link?: string) {
  const body = micromark(withoutWeftLines(reply), { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head><body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">Kept ${new Date().toDateString()}${link ? ` · from <a href="${escapeHtml(link)}">${escapeHtml(link)}</a>` : ""}</div>
${body}
</body></html>`;
}

// Library pages run on Weft's own origin so their ticks can save; scripts may only be the page's own.
export const PAGE_HEADERS = {
  "content-security-policy":
    "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src * data: blob:; media-src * data: blob:; style-src 'self' 'unsafe-inline' https:; font-src * data:; frame-src https:",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
};


// The saved page as the pane gets it: its checkboxes clickable, and each tick saved to the library.
export function withTicks(html: string, item: Pick<LibraryItem, "id" | "ticked">) {
  const script = `<script>(() => {
  const saved = ${JSON.stringify(item.ticked ?? null)};
  const boxes = [...document.querySelectorAll('input[type=checkbox]')];
  boxes.forEach((box, i) => {
    box.disabled = false;
    if (saved) box.checked = saved.includes(i);
    box.addEventListener('change', () => {
      fetch('/api/library/${item.id}', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-threadboard': '1' },
        body: JSON.stringify({ ticked: boxes.flatMap((b, n) => (b.checked ? [n] : [])) }),
      });
    });
  });
})();</script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${script}</body>`) : html + script;
}

// ---- Recipes ----

// Weft marks the skills it writes, so taking a recipe out of the library only deletes a skill Weft made.
export const SKILL_MARK = "<!-- Saved from a Weft card as a recipe. -->";

export function skillsDir(scope: LibraryScope, folder: string) {
  return scope === "mine" ? path.join(os.homedir(), ".claude", "skills") : path.join(folder, ".claude", "skills");
}

export function recipePrompt(card: Pick<Card, "title" | "prompt">, reply: string) {
  return `Turn this request into a reusable recipe: a prompt the user can run again later for a different subject.
Replace the parts that would change next time (the product, client, audience, date, file or folder it's about) with short named blanks in curly braces, one or two plain lowercase words each, like {product} or {audience} or {brand folder}. Keep everything else as it was, in the user's own words. Don't add blanks for things that should stay the same.
Answer with JSON only, no code fence:
{"name": "kebab-case-skill-name, 2-4 words", "title": "Short title, imperative, under 60 chars", "description": "One sentence: what running it makes", "prompt": "the prompt with {blanks}", "blanks": [{"name": "product", "hint": "a few words on what to fill in"}], "makes": ["up to 5 short names of what a run produces"]}

The request (titled ${JSON.stringify(card.title)}):
${card.prompt.slice(0, 8000)}

What the thread made (for "makes"):
${withoutWeftLines(reply).slice(0, 4000)}`;
}

export interface RecipeDraft {
  name: string;
  title: string;
  description: string;
  prompt: string;
  blanks: RecipeBlank[];
  makes: string[];
}

// Haiku's answer, or the card's own prompt as is when the answer is missing or malformed.
export function parseRecipeDraft(text: string, card: Pick<Card, "title" | "prompt">): RecipeDraft {
  const fallback: RecipeDraft = { name: "", title: card.title, description: "", prompt: card.prompt, blanks: [], makes: [] };
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let raw: Partial<RecipeDraft>;
  try {
    raw = JSON.parse(json) as Partial<RecipeDraft>;
  } catch {
    raw = {};
  }
  const prompt = typeof raw.prompt === "string" && raw.prompt.trim() ? raw.prompt.trim() : fallback.prompt;
  const hints = new Map(
    (Array.isArray(raw.blanks) ? (raw.blanks as (Partial<RecipeBlank> | null)[]) : [])
      .filter((b): b is RecipeBlank => typeof b?.name === "string")
      .map((b) => [b.name.trim(), typeof b.hint === "string" ? b.hint.trim() : undefined]),
  );
  return {
    name: typeof raw.name === "string" ? raw.name : "",
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 80) : fallback.title,
    description: typeof raw.description === "string" ? raw.description.trim() : "",
    prompt,
    // The blanks are whatever the prompt really has, in order; Haiku only adds the hints.
    blanks: blanksIn(prompt).map((name) => ({ name, ...(hints.get(name) ? { hint: hints.get(name) } : {}) })),
    makes: (Array.isArray(raw.makes) ? raw.makes : []).filter((m): m is string => typeof m === "string").slice(0, 6),
  };
}

// A skill name that's free in that folder: kebab case, from the draft's name or its title.
export function skillName(wanted: string, dir: string) {
  const base =
    wanted
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "recipe";
  let name = base;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${base}-${n}`;
  return name;
}

export function skillMarkdown(name: string, draft: RecipeDraft) {
  const blanks = draft.blanks.map((b) => b.name);
  const quote = (s: string) => JSON.stringify(s);
  return `---
name: ${name}
description: ${quote(draft.description || draft.title)}
${blanks.length ? `argument-hint: ${quote(blanks.map((b) => `<${b}>`).join(" "))}\n` : ""}---
${SKILL_MARK}

${draft.prompt}
${blanks.length ? `\nFill the blanks in {braces} from the arguments, in order: $ARGUMENTS. Ask for any that are missing.\n` : ""}`;
}

// ---- Starring ----

export interface StarDeps {
  // What the card's browser pane shows: "" for nothing, undefined with no desktop app.
  paneUrl(cardId: string): Promise<string | undefined>;
  // A Haiku completion (lib/haiku.ts), to turn a prompt into a recipe.
  complete(prompt: string): Promise<string>;
}

// Files a card in the library and stars it. A to-do or note keeps the page the card's pane shows (with its
// images), or its last answer when there's none; a recipe becomes a skill.
export async function starCard(card: Card, kind: LibraryKind, scope: LibraryScope, deps: StarDeps): Promise<LibraryItem> {
  if (card.libraryId && getItem(card.libraryId)) removeItem(card.libraryId);
  const reply = lastReply(getThread(card.id));
  const base = { kind, scope, folder: card.cwd, cardId: card.id };
  let item: LibraryItem;

  if (kind === "recipe") {
    const draft = parseRecipeDraft(await deps.complete(recipePrompt(card, reply)).catch(() => ""), card);
    const dir = skillsDir(scope, card.cwd);
    const name = skillName(draft.name || draft.title, dir);
    const skillPath = path.join(dir, name);
    fs.mkdirSync(skillPath, { recursive: true });
    fs.writeFileSync(path.join(skillPath, "SKILL.md"), skillMarkdown(name, draft));
    item = addItem({
      ...base,
      title: draft.title,
      skill: name,
      skillPath,
      prompt: draft.prompt,
      description: draft.description,
      blanks: draft.blanks,
      makes: draft.makes,
    });
  } else {
    const id = randomUUID();
    const out = path.join(scopeDir(scope, card.cwd), id);
    fs.mkdirSync(out, { recursive: true });
    const url = (await deps.paneUrl(card.id).catch(() => undefined)) ?? "";
    let html: string | undefined;
    let link: string | undefined;
    if (/^file:\/\//i.test(url)) {
      try {
        const file = fileURLToPath(url.split(/[?#]/)[0] ?? "");
        if (fs.statSync(file).size <= MAX_FILE_BYTES) html = bundlePage(fs.readFileSync(file, "utf8"), path.dirname(file), out);
      } catch {}
    } else if (/^https?:/i.test(url) && !isWeftPage(url)) {
      link = url;
    }
    html ??= replyPage(card.title, reply || card.prompt, link);
    fs.writeFileSync(path.join(out, "index.html"), html);
    const steps = countCheckboxes(html);
    item = addItem({ ...base, title: pageTitle(html) ?? card.title, page: true, ...(link ? { link } : {}), ...(steps ? { steps } : {}) }, id);
  }
  updateCard(card.id, { libraryId: item.id });
  return item;
}

// A library page already open in the pane (starring it again shouldn't save Weft's own page of it).
function isWeftPage(url: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api\/library\//i.test(url);
}

// ---- Recipe pages ----

// The cards run from a recipe, newest first.
export function recipeRuns(recipeId: string, cards: Card[] = listCards()) {
  return cards.filter((c) => c.recipeId === recipeId).sort((a, b) => b.createdAt - a.createdAt);
}

const RUN_TINTS = ["#2d5a4a,#6f8a6a", "#1d2b4a,#4a6fb4", "#6b2f1e,#b4542f", "#4a3a5e,#8f97d6", "#5a4a1e,#c99a2e"];

function minutes(ms: number) {
  const m = Math.round(ms / 60000);
  return m < 1 ? "<1 min" : m < 90 ? `${m} min` : `${Math.round(m / 60)} h`;
}

// The page beside the New thread dialog when you run a recipe: its blanks, what it makes, and its last runs.
export function recipePage(item: LibraryItem, runs: Card[], home = os.homedir()) {
  const tilde = (p: string) => (p.startsWith(home) ? `~${p.slice(home.length)}` : p);
  const done = runs.filter((r) => r.column === "review" || r.column === "done");
  const avgTime = done.length ? done.reduce((a, r) => a + (r.updatedAt - r.createdAt), 0) / done.length : undefined;
  const blanks = item.blanks ?? [];
  const tile = (run: Card, i: number) => `<a class="run" href="weft://card/${run.id}">
  <div class="th" style="background:linear-gradient(135deg,${RUN_TINTS[i % RUN_TINTS.length]})">${escapeHtml(run.title.slice(0, 40))}</div>
  <div class="cap">${new Date(run.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${escapeHtml(run.column.replace("_", " "))}</div></a>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(item.title)}</title><style>
body{margin:0;background:#f6f1e7;color:#2a2420;font:14px/1.5 -apple-system,system-ui,sans-serif;padding:22px 24px}
.k{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#b4542f}
h1{font:600 24px/1.2 Georgia,serif;margin:3px 0 4px}.d{color:#5b5048;margin:0 0 14px}
h2{font:600 14px Georgia,serif;margin:18px 0 7px}
.blank{display:grid;grid-template-columns:130px 1fr;gap:10px;align-items:baseline;padding:6px 0;border-bottom:1px solid #e2d8c7}
.blank b{font:600 13px ui-monospace,Menlo,monospace;color:#b4542f}.blank span{color:#8a7f74;font-style:italic}
.makes{display:flex;gap:6px;flex-wrap:wrap}.makes span{background:#f1e7d6;border-radius:99px;padding:2px 10px;font-size:12.5px}
.runs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.run{display:block;background:#fffdf8;border:1px solid #e2d8c7;border-radius:9px;overflow:hidden;text-decoration:none;color:inherit}
.run:hover{border-color:#b4542f}.th{height:64px;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 8px;font:600 13px Georgia,serif;color:#fff}
.cap{padding:5px 8px;color:#8a7f74;font-size:11.5px}
.none{color:#8a7f74;font-style:italic}
.meta{display:flex;flex-wrap:wrap;gap:14px;color:#8a7f74;font-size:12px;margin-top:18px;border-top:1px solid #e2d8c7;padding-top:9px}
.meta code{font-size:11.5px}
</style></head><body>
<div class="k">↻ Recipe · ${item.scope === "mine" ? "mine" : escapeHtml(path.basename(item.folder))} · ${runs.length ? `used ${runs.length}×` : "not run yet"}</div>
<h1>${escapeHtml(item.title)}</h1>
${item.description ? `<p class="d">${escapeHtml(item.description)}</p>` : ""}
<h2>${blanks.length ? "Fill in the blanks in the prompt" : "No blanks: it runs as written"}</h2>
${blanks.map((b) => `<div class="blank"><b>{${escapeHtml(b.name)}}</b><span>${escapeHtml(b.hint ?? "")}</span></div>`).join("\n")}
${item.makes?.length ? `<h2>What you'll get</h2><div class="makes">${item.makes.map((m) => `<span>${escapeHtml(m)}</span>`).join("")}</div>` : ""}
<h2>Last runs</h2>
${runs.length ? `<div class="runs">${runs.slice(0, 6).map(tile).join("\n")}</div>` : `<p class="none">This is the first run.</p>`}
<div class="meta">${avgTime ? `<span>⏱ ~${minutes(avgTime)}</span>` : ""}${item.skill ? `<span>Saved as <code>/${escapeHtml(item.skill)}</code> in <code>${escapeHtml(tilde(item.skillPath ?? ""))}</code></span>` : ""}</div>
</body></html>`;
}
