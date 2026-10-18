// Which words in a thread message name a file in the card's folder, so the thread can link them to the editor
// column (components/Markdown.tsx). Matching is against the folder's real file list (lib/client-files.ts list),
// never a guess: "Next.js", "weft.zip" or a path that isn't there stay plain text. A reference may be the full
// relative path, an absolute path inside the folder, a unique tail of a path ("api/cards/[id]/files/route.ts"),
// a unique bare name ("ToolLine.tsx"), or a folder whose one entry file is unambiguous ("/api/cards/[id]/files"
// opens its route.ts), with an optional ":line" or ":line:col".

export interface FileIndex {
  cwd: string;
  files: Set<string>;
  // Every tail of every path ("a/b/c.ts", "b/c.ts", "c.ts") → the paths that end with it.
  tails: Map<string, string[]>;
  // Every tail of a folder that holds an entry file → that folder's entry files.
  dirs: Map<string, string[]>;
}

export interface FileRef {
  path: string;
  line?: number;
}

// The file a folder reference opens: a Next route or page, an index, a README.
const ENTRY = ["route.ts", "route.tsx", "route.js", "page.tsx", "page.ts", "page.jsx", "index.ts", "index.tsx", "index.js", "README.md"];

function add(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key);
  if (!list) map.set(key, [value]);
  else if (!list.includes(value)) list.push(value);
}

export function buildFileIndex(files: string[], cwd: string): FileIndex {
  const tails = new Map<string, string[]>();
  const dirs = new Map<string, string[]>();
  for (const file of files) {
    const parts = file.split("/");
    for (let i = 0; i < parts.length; i++) add(tails, parts.slice(i).join("/"), file);
    const name = parts[parts.length - 1] ?? "";
    if (parts.length > 1 && ENTRY.includes(name)) {
      for (let i = 0; i < parts.length - 1; i++) add(dirs, parts.slice(i, -1).join("/"), file);
    }
  }
  return { cwd: cwd.replace(/\/+$/, ""), files: new Set(files), tails, dirs };
}

// The one entry file of the matching folders, preferring ENTRY's order (a route.ts over its README.md).
function entryOf(candidates: string[] | undefined): string | null {
  if (!candidates) return null;
  const folders = new Set(candidates.map((f) => f.slice(0, f.lastIndexOf("/"))));
  if (folders.size !== 1) return null;
  const rank = (f: string) => ENTRY.indexOf(f.slice(f.lastIndexOf("/") + 1));
  return [...candidates].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

const LINE = /:(\d+)(?::\d+)?$/;

// The file `raw` names in the folder, or null. `raw` is one token: no spaces.
export function resolveFileRef(index: FileIndex, raw: string): FileRef | null {
  const m = LINE.exec(raw);
  const line = m ? Number(m[1]) : undefined;
  let p = (m ? raw.slice(0, m.index) : raw).replace(/\/+$/, "");
  if (p.startsWith(index.cwd + "/")) p = p.slice(index.cwd.length + 1);
  p = p.replace(/^\.\//, "").replace(/^\/+/, "");
  if (!p || p.startsWith("../")) return null;
  const withLine = (path: string): FileRef => (line ? { path, line } : { path });
  if (index.files.has(p)) return withLine(p);
  const tail = index.tails.get(p);
  if (tail?.length === 1 && tail[0]) return withLine(tail[0]);
  if (tail) return null;
  const entry = entryOf(index.dirs.get(p));
  return entry ? withLine(entry) : null;
}

export type Piece = string | { text: string; ref: FileRef };

// Punctuation that wraps a mention in prose: "(see lib/a.ts)", "`lib/a.ts`,", "lib/a.ts." The ":12" of a line stays.
const LEAD = /^[("'“‘<[{*_]+/;
const TRAIL = /[)"'”’>\]},;!?*_]+$|[.:]+$/;
// Only these can be paths at all; anything else is skipped before a lookup.
const PATHY = /[./]/;
const URLISH = /^(?:[a-z][a-z+.-]*:\/\/|www\.|mailto:)/i;

function trimToken(word: string): { lead: string; core: string; trail: string } {
  const lead = LEAD.exec(word)?.[0] ?? "";
  let core = word.slice(lead.length);
  let trail = "";
  // Strip trailing punctuation a few rounds: "lib/a.ts)." ends in two kinds.
  for (let i = 0; i < 3; i++) {
    const t = TRAIL.exec(core)?.[0];
    if (!t || t.length === core.length) break;
    trail = t + trail;
    core = core.slice(0, -t.length);
  }
  return { lead, core, trail };
}

// The mention in one whitespace-free word, if any. A closing ")" or "]" may be the path's own
// ("app/(site)/page.tsx", "cards/[id]"), so each trimmed-off tail is tried back on, shortest first.
function mention(index: FileIndex, word: string): { lead: string; core: string; trail: string; ref: FileRef } | null {
  const { lead, core, trail } = trimToken(word);
  if (!PATHY.test(core) || URLISH.test(core)) return null;
  for (let k = 0; k <= trail.length; k++) {
    const ref = resolveFileRef(index, core + trail.slice(0, k));
    if (ref) return { lead, core: core + trail.slice(0, k), trail: trail.slice(k), ref };
  }
  return null;
}

// `text` cut into plain runs and file mentions, in order. Plain text with no mention comes back as [text].
export function splitFileRefs(index: FileIndex, text: string): Piece[] {
  const out: Piece[] = [];
  let plain = "";
  let last = 0;
  for (const match of text.matchAll(/\S+/g)) {
    const word = match[0];
    const start = match.index;
    const found = mention(index, word);
    if (!found) continue;
    plain += text.slice(last, start) + found.lead;
    if (plain) out.push(plain);
    out.push({ text: found.core, ref: found.ref });
    plain = found.trail;
    last = start + word.length;
  }
  plain += text.slice(last);
  if (plain) out.push(plain);
  return out.length ? out : [text];
}
