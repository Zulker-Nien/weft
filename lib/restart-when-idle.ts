import { randomUUID } from "node:crypto";
import { shell } from "./browser-tools";
import { publish, subscribe } from "./bus";
import { globalSingleton } from "./global-singleton";
import { busyCards, queued } from "./runner-state";
import { addScheduled } from "./schedule";
import { getCard, updateCard } from "./store";
import type { RestartStatus } from "./types";

// Restart when idle: restarting Weft cuts off every running turn, so instead you arm a restart. From then no new
// turn starts (lib/runner.ts asks holdForRestart first): a message sent to a card waits on it as a scheduled message,
// due now, which lib/scheduler.ts sends once Weft is back. When the last running turn ends, the server asks Electron
// main to relaunch, or to install the downloaded update (electron/main.cjs "POST /app/restart"). It lives in memory
// only, so the restart itself disarms it.

export type RestartThen = NonNullable<RestartStatus["then"]>;

// A queued message goes out a tick after its card's turn ends, so the board only counts as idle once it has stayed
// idle this long.
export const SETTLE_MS = 1_000;

export const COPILOT_HELD = "Weft restarts once the running threads finish, so the copilot is paused until then.";
export const RERUN_HELD = "Weft restarts once the running threads finish, so this can't run now. Run it again after the restart.";

interface Drain {
  then: RestartThen;
  stop: () => void;
  timer?: ReturnType<typeof setTimeout>;
  // The status last published, so a card event that changes nothing stays quiet.
  last?: string;
}

const state = globalSingleton("__weftRestart", () => ({ drain: undefined as Drain | undefined }));

export function restartArmed(): boolean {
  return state.drain !== undefined;
}

// The cards the restart waits on: running a turn now, or with queued messages still to run.
function waiting(): RestartStatus["waiting"] {
  const ids = new Set([...busyCards(), ...queued.keys()]);
  return [...ids].map((id) => ({ id, title: getCard(id)?.title ?? "A thread" }));
}

export function restartStatus(): RestartStatus {
  const drain = state.drain;
  return drain ? { armed: true, then: drain.then, waiting: waiting() } : { armed: false, waiting: waiting() };
}

// Arms the restart, or turns an armed relaunch into an update. With nothing running it restarts after SETTLE_MS.
export function armRestart(then: RestartThen = "relaunch"): RestartStatus {
  if (!process.env.THREADBOARD_SHELL_URL) throw new Error("Restarting Weft needs the desktop app.");
  let drain = state.drain;
  if (drain) {
    if (then === "update") drain.then = "update";
  } else {
    const armed = { then } as Drain;
    armed.stop = subscribe((event) => {
      if (event.type === "card") check(armed);
    });
    drain = state.drain = armed;
  }
  check(drain);
  return restartStatus();
}

function disarm(error?: string): RestartStatus {
  const drain = state.drain;
  if (drain) {
    drain.stop();
    clearTimeout(drain.timer);
    state.drain = undefined;
  }
  const status = { ...restartStatus(), ...(error && { error }) };
  publish({ type: "restart", restart: status });
  return status;
}

export function cancelRestart(): RestartStatus {
  return disarm();
}

// Tells the board what the restart waits on when that changed, and restarts once nothing has run for SETTLE_MS.
function check(drain: Drain) {
  const status = restartStatus();
  const key = JSON.stringify(status);
  if (key !== drain.last) {
    drain.last = key;
    publish({ type: "restart", restart: status });
  }
  clearTimeout(drain.timer);
  if (status.waiting.length) return;
  drain.timer = setTimeout(() => {
    if (state.drain === drain && !waiting().length) void restartNow(drain);
  }, SETTLE_MS);
}

// Stays armed while Electron quits, so nothing starts in the meantime.
async function restartNow(drain: Drain) {
  try {
    await shell("/app/restart", { then: drain.then });
  } catch (err) {
    if (state.drain === drain) disarm(`Weft couldn't restart: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// While a restart is armed, keeps a message from starting a turn: it waits on its card, due now, so it goes out
// first thing after the restart (or on the scheduler's next check, if you cancel). False when nothing's armed.
// The copilot takes no scheduled messages, and a re-run of the last message (echo off) would show it twice, so
// both are told why instead.
export function holdForRestart(cardId: string, text: string, { echo = true } = {}): boolean {
  if (!state.drain) return false;
  if (!echo) throw new Error(RERUN_HELD);
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  if (card.role === "copilot") throw new Error(COPILOT_HELD);
  const held = { id: randomUUID(), text, at: Date.now(), afterRestart: true };
  updateCard(cardId, { scheduled: addScheduled(card.scheduled, held) });
  return true;
}
