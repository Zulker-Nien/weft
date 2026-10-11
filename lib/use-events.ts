"use client";

import { useEffect, useRef } from "react";
import type { BoardEvent } from "./types";

// Subscribes to the server's live event stream. onOpen runs on the first connect and every
// reconnect, so callers can reload anything they might have missed.
export function useBoardEvents(onEvent: (event: BoardEvent) => void, onOpen: () => void) {
  const handlers = useRef({ onEvent, onOpen });

  useEffect(() => {
    handlers.current = { onEvent, onOpen };
  });

  useEffect(() => {
    const events = new EventSource("/api/events");
    events.onopen = () => handlers.current.onOpen();
    events.onmessage = (message: MessageEvent<string>) => handlers.current.onEvent(JSON.parse(message.data) as BoardEvent);
    return () => events.close();
  }, []);
}
