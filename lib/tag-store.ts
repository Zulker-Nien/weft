import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, listCards, updateCard } from "./store";
import { MAX_DESCRIPTION, normalizeTag, normalizeTags, tagCounts, type TagInfo, type TagRow } from "./tags";

// The tag catalog, like a repo's GitHub labels: a tag can have a colour and a description, exist before
// any card carries it, and be renamed or deleted everywhere at once. Kept in ~/.weft/tags.json; the tags
// on cards are the truth for which cards carry what, so a tag only on cards still lists.
// Changing cards' tags goes through updateCard, which publishes each card, so the board reloads them.

// Read when used, not at import, so routes that only pass through here load without the store.
const catalogFile = () => path.join(DATA_DIR, "tags.json");

function readCatalog(): TagInfo[] {
  try {
    return (JSON.parse(fs.readFileSync(catalogFile(), "utf8")) as { tags?: TagInfo[] }).tags ?? [];
  } catch {
    return [];
  }
}

function writeCatalog(tags: TagInfo[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(catalogFile(), JSON.stringify({ tags }, null, 2));
}

function requireName(raw: unknown): string {
  const name = typeof raw === "string" ? normalizeTag(raw) : undefined;
  if (!name) throw new Error("A tag needs a name.");
  return name;
}

function cleanColor(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const color = typeof raw === "string" ? raw.trim().toLowerCase().replace(/^#?/, "#") : "";
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new Error("A tag's colour is #rrggbb.");
  return color;
}

function cleanDescription(raw: unknown): string | undefined {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION) : "";
  return text || undefined;
}

// A catalog entry with nothing empty in it.
function entry(name: string, color?: string, description?: string): TagInfo {
  return { name, ...(color ? { color } : {}), ...(description ? { description } : {}) };
}

// The catalog and every tag on a card, with counts, by name.
export function listTags(): TagRow[] {
  const counts = new Map(tagCounts(listCards()).map((t) => [t.tag, t.count]));
  const rows: TagRow[] = readCatalog().map((t) => ({ ...t, count: counts.get(t.name) ?? 0 }));
  for (const [name, count] of counts) if (!rows.some((r) => r.name === name)) rows.push({ name, count });
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function createTag(rawName: unknown, color?: unknown, description?: unknown): TagInfo {
  const name = requireName(rawName);
  const catalog = readCatalog();
  if (catalog.some((t) => t.name === name)) throw new Error(`There's already a tag “${name}”.`);
  const tag = entry(name, cleanColor(color), cleanDescription(description));
  writeCatalog([...catalog, tag]);
  return tag;
}

// Renaming rewrites every card that carries it; renaming onto a tag that exists merges the two.
export function updateTag(rawName: unknown, patch: { name?: unknown; color?: unknown; description?: unknown }): TagInfo {
  const name = requireName(rawName);
  const catalog = readCatalog();
  const old = catalog.find((t) => t.name === name);
  if (!old && !listCards().some((c) => c.tags?.includes(name))) throw new Error(`No tag “${name}”.`);
  const next = patch.name === undefined ? name : requireName(patch.name);
  const into = next === name ? undefined : catalog.find((t) => t.name === next);
  const tag = entry(
    next,
    patch.color === undefined ? (old?.color ?? into?.color) : cleanColor(patch.color),
    patch.description === undefined ? (old?.description ?? into?.description) : cleanDescription(patch.description),
  );
  writeCatalog([...catalog.filter((t) => t.name !== name && t.name !== next), tag]);
  if (next !== name) retag(name, next);
  return tag;
}

// Out of the catalog and off every card.
export function deleteTag(rawName: unknown) {
  const name = requireName(rawName);
  writeCatalog(readCatalog().filter((t) => t.name !== name));
  retag(name);
}

// Tags just put on a card join the catalog, so they stay listed after the card drops them.
export function rememberTags(tags: readonly string[]) {
  const catalog = readCatalog();
  const fresh = normalizeTags(tags).filter((name) => !catalog.some((t) => t.name === name));
  if (fresh.length) writeCatalog([...catalog, ...fresh.map((name) => entry(name))]);
}

// Swaps `from` for `to` on every card that has it, or just drops it; a card that had both keeps one.
function retag(from: string, to?: string) {
  for (const card of listCards()) {
    if (!card.tags?.includes(from)) continue;
    updateCard(card.id, { tags: normalizeTags(card.tags.flatMap((t) => (t !== from ? [t] : to ? [to] : []))) });
  }
}
