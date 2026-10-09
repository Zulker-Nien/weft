import { EventEmitter } from "node:events";
import type { BoardEvent } from "./types";

// One emitter per server process, kept on globalThis so dev-mode reloads don't split it.
const g = globalThis as unknown as { __threadboardBus?: EventEmitter };
const bus = (g.__threadboardBus ??= new EventEmitter().setMaxListeners(100));

export function publish(event: BoardEvent) {
  bus.emit("event", event);
}

export function subscribe(listener: (event: BoardEvent) => void) {
  bus.on("event", listener);
  return () => {
    bus.off("event", listener);
  };
}
