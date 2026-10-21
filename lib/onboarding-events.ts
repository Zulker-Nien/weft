"use client";

import { useEffect } from "react";
import { DRAFT, remember } from "./new-thread";

// Window events the welcome (and the empty board's start panel) send the board: open the New thread dialog on a
// folder with a prompt already written, or open a card the welcome just started.
export const OPEN_NEW_THREAD = "weft:open-new-thread";
export const SELECT_CARD = "weft:select-card";

export type OpenNewThreadDetail = { cwd?: string; prompt?: string };
export type SelectCardDetail = { id: string };

export const openNewThread = (detail: OpenNewThreadDetail) => window.dispatchEvent(new CustomEvent(OPEN_NEW_THREAD, { detail }));
export const selectCard = (id: string) => window.dispatchEvent(new CustomEvent<SelectCardDetail>(SELECT_CARD, { detail: { id } }));

// The board's side: the prompt goes in as the New thread draft, which the dialog reads as it opens.
export function useOnboardingEvents(openNew: (folder?: string) => void, select: (id: string) => void) {
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { cwd, prompt } = (e as CustomEvent<OpenNewThreadDetail | null>).detail ?? {};
      if (prompt) remember(DRAFT, prompt);
      openNew(cwd);
    };
    const onSelect = (e: Event) => {
      const id = (e as CustomEvent<SelectCardDetail | null>).detail?.id;
      if (id) select(id);
    };
    window.addEventListener(OPEN_NEW_THREAD, onOpen);
    window.addEventListener(SELECT_CARD, onSelect);
    return () => {
      window.removeEventListener(OPEN_NEW_THREAD, onOpen);
      window.removeEventListener(SELECT_CARD, onSelect);
    };
  }, [openNew, select]);
}
