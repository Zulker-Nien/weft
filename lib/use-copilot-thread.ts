"use client";

import { useCallback, useRef, useState } from "react";
import { api, mergeThread } from "./client";
import { useBoardEvents } from "./use-events";
import { COPILOT_ID, type Card, type ThreadItem } from "./types";

// The copilot's card and conversation, kept live, for the board's copilot lane.
export function useCopilotThread() {
  const [card, setCard] = useState<Card | null>(null);
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  const opened = useRef(false);

  // The first load keeps live items that arrived during the fetch; after a reconnect, what's shown
  // may be stale, so the snapshot replaces it.
  const load = useCallback(async () => {
    const merge = !opened.current;
    opened.current = true;
    const { card } = await api.copilot();
    setCard(card);
    const { items } = await api.thread(card.id);
    setItems((prev) => (merge ? mergeThread(items, prev) : items));
  }, []);

  useBoardEvents(
    (event) => {
      switch (event.type) {
        case "card":
          if (event.card.id === COPILOT_ID) setCard(event.card);
          break;
        case "thread":
          if (event.cardId !== COPILOT_ID) break;
          setItems((prev) => {
            const next = event.truncate ? prev.slice(0, event.index) : prev.slice();
            next[event.index] = event.item;
            return next;
          });
          if (event.item.kind === "assistant" || event.item.kind === "result") setStreaming("");
          break;
        case "thread_cleared":
          if (event.cardId !== COPILOT_ID) break;
          setItems([]);
          setStreaming("");
          break;
        case "delta":
          if (event.cardId === COPILOT_ID) setStreaming((text) => text + event.text);
          break;
      }
    },
    () => {
      load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    },
  );

  const fail = useCallback((err: unknown) => setError(err instanceof Error ? err.message : String(err)), []);

  const send = useCallback(async (text: string) => {
    setError(null);
    await api.send(COPILOT_ID, text);
  }, []);

  // The reset ends the copilot's CLI first, which can take a few seconds mid-turn; until it's back,
  // the New chat button is off so repeat clicks don't queue more resets.
  const [resetting, setResetting] = useState(false);
  const newChat = useCallback(async () => {
    setItems([]);
    setStreaming("");
    setResetting(true);
    try {
      const { card } = await api.resetCopilot();
      setCard(card);
    } finally {
      setResetting(false);
    }
  }, []);

  return { card, items, streaming, error, fail, send, newChat, resetting };
}
