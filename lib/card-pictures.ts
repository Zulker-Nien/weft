import { MEDIA_REF, mediaKind, mediaUrl } from "./media";
import type { Card, ThreadItem } from "./types";

// The pictures a card shows as its thumbnail: images in its thread (a screenshot a tool took, one the
// agent posted, one you pasted) and a capture of its browser pane page after each turn (lib/glance.ts).

// The board URLs of the images in one thread item, in order.
export function itemPictures(item: ThreadItem): string[] {
  if (item.kind === "tool") return item.images ?? [];
  if (item.kind !== "user" && item.kind !== "assistant") return [];
  if (!item.text.includes("![")) return [];
  const urls: string[] = [];
  for (const match of item.text.matchAll(MEDIA_REF)) {
    const src = match[2] ?? match[3] ?? "";
    const url = mediaKind(src) === "image" ? mediaUrl(src) : null;
    if (url) urls.push(url);
  }
  return urls;
}

// The card fields for a whole thread: how many pictures it has and the latest one.
export function threadPictures(items: ThreadItem[]): Pick<Card, "pictures" | "thumb"> {
  const urls = items.flatMap(itemPictures);
  return { pictures: urls.length, thumb: urls.at(-1) };
}

// The patch after one item was added, or replaced `before` (a tool call getting its result).
// Undefined when the card's pictures didn't change, so nothing is saved.
export function picturesPatch(card: Card, item: ThreadItem, before?: ThreadItem): Pick<Card, "pictures" | "thumb"> | undefined {
  const added = itemPictures(item);
  const removed = before ? itemPictures(before).length : 0;
  if (added.length === removed) return undefined;
  return {
    pictures: Math.max(0, (card.pictures ?? 0) + added.length - removed),
    thumb: added.length > removed ? added.at(-1) : card.thumb,
  };
}

// One emoji for the card's tile when it has no picture yet, from Haiku's reply; undefined if it sent none.
export function parseEmoji(reply: string) {
  return /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/u.exec(reply)?.[0];
}

export function emojiPrompt(title: string) {
  return `Reply with exactly one emoji that best stands for this coding task, and nothing else.\n\nTask: ${title}`;
}

// The tile's fallback before Haiku has picked an emoji: the folder's first letter.
export function monogram(folder: string) {
  return (/[a-z0-9]/i.exec(folder)?.[0] ?? "•").toUpperCase();
}
