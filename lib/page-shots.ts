// Pictures of the pages a card's browser pane showed, for the show rail (components/ShowRail.tsx): the
// newest capture of each page, per card, in ~/.weft/shots/<card>/ (one small WebP per page, overwritten,
// plus index.json from page url to file and time). Captured by the rail (POST /api/cards/[id]/shots)
// when the open card's page or thread settles, never on the reply's path.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { paneThumb, paneUrl } from "./browser-tools";
import { DATA_DIR } from "./store";

type Index = Record<string, { file: string; at: number }>;

const SHOTS_DIR = path.join(DATA_DIR, "shots");
const FILE = /^[a-f0-9]{16}\.webp$/;
// A page captured this recently isn't captured again (the rail asks on every settle).
export const FRESH_MS = 8_000;
// The rail draws a picture about 64 px wide: twice that for a Retina screen, the page's top in a 4:5
// crop, at a quality that keeps each file to a few KB.
export const SHOT = { width: 144, height: 180, quality: 55 };

// Card ids are the board's own, but they name a folder here: nothing that could climb out of it.
const cardDir = (card: string) => path.join(SHOTS_DIR, card.replace(/[^\w-]/g, "_"));
const indexFile = (card: string) => path.join(cardDir(card), "index.json");
export const shotName = (url: string) => `${createHash("sha1").update(url).digest("hex").slice(0, 16)}.webp`;

function readIndex(card: string): Index {
  try {
    return JSON.parse(fs.readFileSync(indexFile(card), "utf8")) as Index;
  } catch {
    return {};
  }
}

// Shrinks a pane capture (a 480 px JPEG from electron/browser-pane.cjs) to the rail's size; undefined if it won't decode.
export async function shrink(image: Buffer): Promise<Buffer | undefined> {
  try {
    return await sharp(image)
      .resize({ width: SHOT.width, height: SHOT.height, fit: "cover", position: "top" })
      .webp({ quality: SHOT.quality, effort: 4 })
      .toBuffer();
  } catch {
    return undefined;
  }
}

export async function saveShot(card: string, url: string, image: Buffer, at = Date.now()): Promise<boolean> {
  const small = await shrink(image);
  if (!small) return false;
  const file = shotName(url);
  fs.mkdirSync(cardDir(card), { recursive: true });
  fs.writeFileSync(path.join(cardDir(card), file), small);
  fs.writeFileSync(indexFile(card), JSON.stringify({ ...readIndex(card), [url]: { file, at } }));
  return true;
}

// Page url → the picture's src, with its time so a newer capture of the same page isn't served from cache.
export function listShots(card: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(readIndex(card))
      // An entry from an older format (a full-size .jpg) is no picture; the next capture replaces it.
      .filter(([, { file }]) => FILE.test(file))
      .map(([url, { file, at }]) => [url, `/api/cards/${encodeURIComponent(card)}/shots?img=${file.split(".")[0]}&v=${at}`]),
  );
}

export function readShot(card: string, name: string): Buffer | undefined {
  const file = `${name}.webp`;
  if (!FILE.test(file)) return undefined;
  try {
    return fs.readFileSync(path.join(cardDir(card), file));
  } catch {
    return undefined;
  }
}

// Captures the card's pane if it still shows url (the page may have moved on while the rail waited).
export async function captureShot(card: string, url: string, now = Date.now()): Promise<boolean> {
  const last = readIndex(card)[url];
  if (last && now - last.at < FRESH_MS) return false;
  if ((await paneUrl(card)) !== url) return false;
  const jpg = await paneThumb(card);
  return jpg ? saveShot(card, url, jpg, now) : false;
}
