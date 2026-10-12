"use client";

import { useRef, useState } from "react";
import type { EditorView } from "@tiptap/pm/view";
import { findSecret, type SecretMatch } from "@/lib/secret-detect";
import Icon from "./Icon";

// The Composer's paste guard: a paste that looks like a secret (lib/secret-detect.ts) waits in a strip
// under the editor until you paste it anyway or drop it, because a thread keeps everything you send in
// its transcripts for good (docs/architecture/secrets.md).

export interface SecretPasteGuard {
  held: { text: string; match: SecretMatch } | null;
  // Holds the text if it looks like a secret; true means the caller shouldn't paste it.
  hold: (text: string) => boolean;
  // Pastes text into the rich editor as if nothing had stopped it.
  pasteInto: (view: EditorView | undefined, text: string) => void;
  clear: () => void;
}

export function useSecretPaste(): SecretPasteGuard {
  const [held, setHeld] = useState<SecretPasteGuard["held"]>(null);
  // Set while "Paste anyway" replays the paste, so the editor's paste handler lets it through.
  const replaying = useRef(false);
  return {
    held,
    hold: (text) => {
      const match = replaying.current ? null : findSecret(text);
      if (match) setHeld({ text, match });
      return match !== null;
    },
    pasteInto: (view, text) => {
      if (!view) return;
      replaying.current = true;
      view.pasteText(text);
      replaying.current = false;
      view.focus();
    },
    clear: () => setHeld(null),
  };
}

export default function SecretPasteBar({ guard, onPaste }: { guard: SecretPasteGuard; onPaste: (text: string) => void }) {
  const { held } = guard;
  if (!held) return null;
  return (
    <div role="alert" className="flex shrink-0 items-center gap-2 border-t border-warn/40 bg-warn-soft px-3 py-1.5 text-[11.5px] text-warn">
      <Icon name="lock" size={12} />
      <span className="min-w-0 flex-1">
        That looks like {held.match.kind} (<code className="font-mono">{held.match.preview}</code>). Threads keep what you send for good.
      </span>
      <button
        type="button"
        onClick={() => {
          guard.clear();
          onPaste(held.text);
        }}
        className="shrink-0 rounded px-1.5 py-0.5 font-medium hover:bg-warn/15"
      >
        Paste anyway
      </button>
      <button type="button" onClick={guard.clear} className="shrink-0 rounded px-1.5 py-0.5 font-medium text-ink hover:bg-warn/15">
        Don&apos;t paste
      </button>
    </div>
  );
}
