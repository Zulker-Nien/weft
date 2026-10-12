import { useState } from "react";
import { api } from "./client";
import { lastSent } from "./edit-last";
import type { Card, ThreadItem } from "./types";

// ↑ in a board thread's reply box: the message it pulls back (your last one), and while you edit it,
// the thread index to mark: that message, and after it the turn the edit will replace. A message that
// can't rewind goes out as a new one, so nothing is marked. The copilot's thread doesn't edit.
export function useEditLast(card: Card, items: ThreadItem[], onEdited: () => void) {
  // The card whose box is editing, so switching threads doesn't carry the marks over.
  const [editingId, setEditingId] = useState<string | null>(null);
  const onEditing = (on: boolean) => setEditingId(on ? card.id : null);
  const last = card.role === "copilot" ? undefined : lastSent(items);
  if (!last) return { editLast: undefined, editFrom: undefined, onEditing };
  const canRewind = Boolean(last.promptId);
  const onEdit = async (text: string) => {
    await api.editLast(card.id, text);
    onEdited();
  };
  return {
    editLast: { text: last.text, canRewind, fileEdits: last.fileEdits, onEdit },
    editFrom: editingId === card.id && canRewind ? last.index : undefined,
    onEditing,
  };
}
