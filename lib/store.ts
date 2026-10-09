import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { publish } from "./bus";
import type { Card, ThreadItem } from "./types";

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

const g = globalThis as unknown as { __threadboardState?: State };

function state(): State {
  if (g.__threadboardState) return g.__threadboardState;
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
  g.__threadboardState = { cards, threads: new Map() };
  return g.__threadboardState;
}

function saveBoard() {
  const cards = [...state().cards.values()];
  fs.writeFileSync(BOARD_FILE, JSON.stringify({ cards }, null, 2));
}

function threadFile(id: string) {
  return path.join(THREADS_DIR, `${id}.json`);
}

export function listCards(): Card[] {
  return [...state().cards.values()].sort((a, b) => b.updatedAt - a.updatedAt);
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
  return items.length - 1;
}

export function replaceThreadItem(cardId: string, index: number, item: ThreadItem) {
  const items = getThread(cardId);
  items[index] = item;
  saveThread(cardId);
  publish({ type: "thread", cardId, item, index });
}
