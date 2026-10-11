import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { publish } from "./bus";
import { picturesPatch, threadPictures } from "./card-pictures";
import type { Card, ThreadItem } from "./types";
import { globalSingleton } from "./global-singleton";

// The app was called Threadboard and kept its data in ~/.threadboard. Move that folder to
// ~/.weft the first time, unless ~/.weft already exists. If the move fails, keep using the old one.
function defaultDataDir() {
  const dir = path.join(os.homedir(), ".weft");
  const legacy = path.join(os.homedir(), ".threadboard");
  if (!fs.existsSync(dir) && fs.existsSync(legacy)) {
    try {
      fs.renameSync(legacy, dir);
    } catch (err) {
      console.warn(`Couldn't move ${legacy} to ${dir}; using ${legacy}.`, err);
      return legacy;
    }
  }
  return dir;
}

export const DATA_DIR = process.env.THREADBOARD_DATA || defaultDataDir();
const BOARD_FILE = path.join(DATA_DIR, "board.json");
const THREADS_DIR = path.join(DATA_DIR, "threads");

interface State {
  cards: Map<string, Card>;
  threads: Map<string, ThreadItem[]>;
}

function state(): State {
  return globalSingleton("__threadboardState", loadState);
}

function loadState(): State {
  fs.mkdirSync(THREADS_DIR, { recursive: true });
  const cards = new Map<string, Card>();
  if (fs.existsSync(BOARD_FILE)) {
    const saved = JSON.parse(fs.readFileSync(BOARD_FILE, "utf8")) as { cards: Card[] };
    for (const card of saved.cards) {
      // A card can't still be live after a restart: its CLI process is gone.
      card.warm = false;
      if (card.column === "running" || card.pending) {
        card.column = "review";
        card.pending = null;
        card.lastLine = "Stopped when the app closed";
      }
      cards.set(card.id, card);
    }
  }
  return { cards, threads: new Map() };
}

function saveBoard() {
  const cards = [...state().cards.values()];
  fs.writeFileSync(BOARD_FILE, JSON.stringify({ cards }, null, 2));
}

function threadFile(id: string) {
  return path.join(THREADS_DIR, `${id}.json`);
}

export function listCards(): Card[] {
  backfillPictures();
  return [...state().cards.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

const pictured = globalThis as unknown as { __weftPicturesBackfill?: boolean };

// Cards made before thumbnails existed: read their threads once, a card per tick so the server stays
// responsive, then save the board once. Archived cards are skipped; they're hidden anyway.
function backfillPictures() {
  if (pictured.__weftPicturesBackfill) return;
  pictured.__weftPicturesBackfill = true;
  const todo = [...state().cards.values()].filter((c) => c.pictures === undefined && !c.archived);
  if (!todo.length) return;
  const step = () => {
    const card = todo.shift();
    if (!card) {
      saveBoard();
      return;
    }
    const cached = state().threads.has(card.id);
    try {
      const found = threadPictures(getThread(card.id));
      card.pictures = found.pictures;
      card.thumb ??= found.thumb;
      if (found.thumb) publish({ type: "card", card });
      // A thread read only for this stays out of the cache.
      if (!cached) state().threads.delete(card.id);
    } catch {
      card.pictures = 0;
    }
    setImmediate(step);
  };
  setImmediate(step);
}

export function getCard(id: string): Card | undefined {
  return state().cards.get(id);
}

export function createCard(
  input: Omit<Card, "id" | "column" | "createdAt" | "updatedAt">,
  id: string = randomUUID(),
): Card {
  const now = Date.now();
  const card: Card = { ...input, id, column: "backlog", createdAt: now, updatedAt: now };
  state().cards.set(card.id, card);
  saveBoard();
  publish({ type: "card", card });
  return card;
}

// Adds many cards at once with a single save (used when picking up existing sessions).
export function addCards(cards: Card[]) {
  for (const card of cards) state().cards.set(card.id, card);
  saveBoard();
  for (const card of cards) publish({ type: "card", card });
}

export function updateCard(id: string, patch: Partial<Card>): Card {
  const card = state().cards.get(id);
  if (!card) throw new Error(`No card ${id}`);
  Object.assign(card, patch, { updatedAt: Date.now() });
  saveBoard();
  publish({ type: "card", card });
  return card;
}

export function deleteCard(id: string) {
  state().cards.delete(id);
  state().threads.delete(id);
  fs.rmSync(threadFile(id), { force: true });
  saveBoard();
  publish({ type: "card_deleted", id });
}

export function getThread(id: string): ThreadItem[] {
  const threads = state().threads;
  let items = threads.get(id);
  if (!items) {
    const file = threadFile(id);
    items = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as ThreadItem[]) : [];
    threads.set(id, items);
  }
  return items;
}

function saveThread(id: string) {
  fs.writeFileSync(threadFile(id), JSON.stringify(getThread(id)));
}

export function replaceThread(id: string, items: ThreadItem[]) {
  state().threads.set(id, items);
  saveThread(id);
  setPictures(id, threadPictures(items));
}

// Keeps the card's thumbnail current as its thread changes. Not activity, so updatedAt stays put.
function setPictures(cardId: string, patch?: Pick<Card, "pictures" | "thumb">) {
  const card = state().cards.get(cardId);
  if (!card || !patch || (patch.pictures === card.pictures && patch.thumb === card.thumb)) return;
  Object.assign(card, patch);
  saveBoard();
  publish({ type: "card", card });
}

// Sets a card's fields that aren't activity (its pane capture, its emoji), leaving updatedAt alone.
export function decorateCard(id: string, patch: Partial<Pick<Card, "thumb" | "emoji" | "title" | "titleBy">>) {
  const card = state().cards.get(id);
  if (!card) return;
  Object.assign(card, patch);
  saveBoard();
  publish({ type: "card", card });
}

export function clearThread(id: string) {
  state().threads.set(id, []);
  saveThread(id);
}

export function appendThread(cardId: string, item: ThreadItem): number {
  const items = getThread(cardId);
  items.push(item);
  saveThread(cardId);
  publish({ type: "thread", cardId, item, index: items.length - 1 });
  const card = state().cards.get(cardId);
  if (card) setPictures(cardId, picturesPatch(card, item));
  return items.length - 1;
}

export function replaceThreadItem(cardId: string, index: number, item: ThreadItem) {
  const items = getThread(cardId);
  const before = items[index];
  items[index] = item;
  saveThread(cardId);
  const card = state().cards.get(cardId);
  if (card) setPictures(cardId, picturesPatch(card, item, before));
  publish({ type: "thread", cardId, item, index });
}
