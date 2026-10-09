// Short chimes for when a card changes column, played from files in public/sounds/. The files are
// decoded once into Web Audio buffers, so chimes can overlap and the volume is a single gain.
// Preferences live in a cookie for the same reason as the theme (lib/theme.ts): the desktop
// server's port can change. The files are vibraphone samples (CC0, see public/sounds/CREDITS.md),
// built by scripts/samples/build-chimes.mjs in the groovenfill repo. Each file plays once as is, so a
// repeat (like a second ring for Needs you) belongs in the file. To use other sounds, drop them in
// public/sounds/ and change SOUNDS.
import type { Column } from "./types";

export type ChimeKind = Extract<Column, "running" | "needs_you" | "review" | "done"> | "error";

// Formats the board can play. Chromium (and so Electron) decodes all of them.
export const SOUND_FORMATS = [".wav", ".mp3", ".m4a", ".ogg"] as const;

type SoundFile = `/sounds/${string}${(typeof SOUND_FORMATS)[number]}`;

// The file each chime plays: change one line here to swap a sound.
export const SOUNDS: Record<ChimeKind, SoundFile> = {
  running: "/sounds/running.m4a",
  needs_you: "/sounds/needs-you.m4a",
  review: "/sounds/review.m4a",
  done: "/sounds/done.m4a",
  error: "/sounds/error.m4a",
};

// What Settings shows for each chime, and whether it starts out on.
export const CHIMES: Record<ChimeKind, { label: string; hint: string; defaultOn: boolean }> = {
  needs_you: { label: "Needs you", hint: "A thread is waiting on you", defaultOn: true },
  review: { label: "Review", hint: "A turn finished", defaultOn: true },
  done: { label: "Done", hint: "A thread is done", defaultOn: true },
  error: { label: "Error", hint: "A thread hit an error", defaultOn: true },
  running: { label: "Running", hint: "A thread started working", defaultOn: false },
};

export const CHIME_KINDS = Object.keys(CHIMES) as ChimeKind[];

// When several chimes arrive together, the one that plays.
const PRIORITY: ChimeKind[] = ["needs_you", "error", "review", "done", "running"];

// At most one chime this often, so a batch of cards moving at once doesn't make a racket.
const GAP_MS = 350;
// Running can fire for every card that starts, so it gets a longer gap of its own.
const KIND_GAP_MS: Partial<Record<ChimeKind, number>> = { running: 1500 };

export type ChimePrefs = { on: boolean; volume: number; kinds: Record<ChimeKind, boolean> };

export const CHIMES_COOKIE = "weft-chimes";

function defaults(): ChimePrefs {
  return {
    on: true,
    volume: 60,
    kinds: Object.fromEntries(CHIME_KINDS.map((k) => [k, CHIMES[k].defaultOn])) as Record<ChimeKind, boolean>,
  };
}

export function chimePrefs(): ChimePrefs {
  const prefs = defaults();
  const match = document.cookie.match(new RegExp(`(?:^|; )${CHIMES_COOKIE}=([^;]*)`));
  if (!match) return prefs;
  try {
    const saved = JSON.parse(decodeURIComponent(match[1])) as Partial<ChimePrefs>;
    if (typeof saved.on === "boolean") prefs.on = saved.on;
    if (typeof saved.volume === "number") prefs.volume = Math.min(100, Math.max(0, saved.volume));
    for (const k of CHIME_KINDS) if (typeof saved.kinds?.[k] === "boolean") prefs.kinds[k] = saved.kinds[k];
  } catch {}
  return prefs;
}

export function setChimePrefs(prefs: ChimePrefs) {
  const value = encodeURIComponent(JSON.stringify(prefs));
  document.cookie = `${CHIMES_COOKIE}=${value}; path=/; max-age=${10 * 365 * 24 * 60 * 60}; SameSite=Lax`;
}

// One audio context for the page, made on first use, and each file decoded once.
let ctx: AudioContext | null = null;
const buffers = new Map<ChimeKind, Promise<AudioBuffer | null>>();

function context() {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function buffer(kind: ChimeKind) {
  let loading = buffers.get(kind);
  if (!loading) {
    const audio = context();
    loading = fetch(SOUNDS[kind])
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${SOUNDS[kind]}: ${r.status}`))))
      .then((data) => audio.decodeAudioData(data))
      .catch(() => {
        // Try again next time rather than staying silent for the session.
        buffers.delete(kind);
        return null;
      });
    buffers.set(kind, loading);
  }
  return loading;
}

// Fetches and decodes every chime ahead of time, so the first one isn't late.
export function preloadChimes() {
  if (typeof AudioContext === "undefined") return;
  for (const kind of CHIME_KINDS) void buffer(kind);
}

async function sound(kind: ChimeKind, volume: number) {
  if (typeof AudioContext === "undefined" || volume <= 0) return;
  const data = await buffer(kind);
  if (!data) return;
  const audio = context();
  const source = audio.createBufferSource();
  source.buffer = data;
  const gain = audio.createGain();
  // Squared so the slider feels even to the ear.
  gain.gain.value = (volume / 100) ** 2;
  source.connect(gain).connect(audio.destination);
  source.start();
}

let lastAt = 0;
const lastKindAt = new Map<ChimeKind, number>();
let queued: ChimeKind | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

// Plays a chime if it's turned on. Chimes closer together than GAP_MS collapse into the most important one.
export function playChime(kind: ChimeKind) {
  const prefs = chimePrefs();
  if (!prefs.on || !prefs.kinds[kind]) return;
  const kindGap = KIND_GAP_MS[kind];
  if (kindGap && Date.now() - (lastKindAt.get(kind) ?? 0) < kindGap) return;
  if (queued === null || PRIORITY.indexOf(kind) < PRIORITY.indexOf(queued)) queued = kind;
  if (timer) return;
  const wait = Math.max(0, lastAt + GAP_MS - Date.now());
  timer = setTimeout(() => {
    timer = null;
    const next = queued;
    queued = null;
    if (!next) return;
    lastAt = Date.now();
    lastKindAt.set(next, lastAt);
    void sound(next, chimePrefs().volume);
  }, wait);
}

// Plays a chime right away at the current volume, even if it's turned off: the Play button in Settings.
export function previewChime(kind: ChimeKind) {
  void sound(kind, chimePrefs().volume);
}
