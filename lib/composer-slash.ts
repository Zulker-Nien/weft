// Slash detection for the Composer's "/" typeahead: when the cursor sits at the end of a "/name"
// token, returns the match; otherwise null. Pure, so tests can pin the rules without rendering.

import type { Editor } from "@tiptap/react";

export interface SlashQuery {
  query: string;
  from: number;
  to: number;
}

// "/name" typed at the start of a word, right before the cursor.
const SLASH = /(^|\s)\/([\w:.-]*)$/;

// Plain text that looks like Markdown is parsed as Markdown when pasted.
export const LOOKS_LIKE_MARKDOWN = /^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|>\s|```)|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\n]+\)/m;

// The slash query at the editor's cursor, or null when there isn't one. A "/" inside a code block or
// a "!" shell command is a path, not a skill.
export function slashAtCursor(e: Editor): SlashQuery | null {
  const { selection } = e.state;
  if (!selection.empty || e.isActive("codeBlock") || /^\s*!/.test(e.state.doc.textContent)) return null;
  const { $from } = selection;
  const match = SLASH.exec($from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc"));
  const query = match?.[2];
  if (query === undefined) return null;
  return { query, from: $from.pos - query.length - 1, to: $from.pos };
}
