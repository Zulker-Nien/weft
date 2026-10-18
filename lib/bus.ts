import { EventEmitter } from "node:events";
import type { BoardEvent } from "./types";
import { globalSingleton } from "./global-singleton";

// One emitter per server process, kept on globalThis so dev-mode reloads don't split it.
const bus = globalSingleton("__weftBus", () => new EventEmitter().setMaxListeners(100));

export function publish(event: BoardEvent) {
  bus.emit("event", event);
}

export function subscribe(listener: (event: BoardEvent) => void) {
  bus.on("event", listener);
  return () => {
    bus.off("event", listener);
  };
}
