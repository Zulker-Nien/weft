"use client";

import { useDeferredValue, useMemo, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { findSecret, type SecretMatch } from "@/lib/secret-detect";
import Icon from "./Icon";

// The Composer's secret guard, because a thread keeps everything you send in its transcripts for good
// (docs/architecture/secrets.md). A paste that looks like a secret (lib/secret-detect.ts) waits in a strip
// under the editor until you paste it anyway or drop it; one that arrives any other way (typed, dictated,
// dropped in) is flagged in the same strip as the message changes, with Remove it and Keep it.

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

// The warning strip both cases share: what it looks like, masked, and their buttons.
function Strip({ match, children }: { match: SecretMatch; children: ReactNode }) {
  return (
    <div role="alert" className="flex shrink-0 items-center gap-2 border-t border-warn/40 bg-warn-soft px-3 py-1.5 text-[11.5px] text-warn">
      <Icon name="lock" size={12} />
      <span className="min-w-0 flex-1">
        That looks like {match.kind} (<code className="font-mono">{match.preview}</code>). Threads keep what you send for good.
      </span>
      {children}
    </div>
  );
}

const STRIP_BUTTON = "shrink-0 rounded px-1.5 py-0.5 font-medium hover:bg-warn/15";

export default function SecretPasteBar({ guard, onPaste }: { guard: SecretPasteGuard; onPaste: (text: string) => void }) {
  const { held } = guard;
  if (!held) return null;
  return (
    <Strip match={held.match}>
      <button
        type="button"
        onClick={() => {
          guard.clear();
          onPaste(held.text);
        }}
        className={STRIP_BUTTON}
      >
        Paste anyway
      </button>
      <button type="button" onClick={guard.clear} className={`${STRIP_BUTTON} text-ink`}>
        Don&apos;t paste
      </button>
    </Strip>
  );
}

// A secret in the message as it reads now (plain text, not markdown, whose escapes would hide a key's
// shape), unless you chose to keep that value: with Keep it, or by pasting it anyway (keepIn).
export function useTypedSecret(text: string): { match: SecretMatch | null; keep: () => void; keepIn: (pasted: string) => void } {
  const deferred = useDeferredValue(text);
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  // Kept values are blanked first, so a second key after one you kept is still found.
  const match = useMemo(() => findSecret([...kept].reduce((t, v) => t.replaceAll(v, " "), deferred)), [deferred, kept]);
  const keepValue = (value: string | undefined) => value && setKept((k) => new Set(k).add(value));
  return { match, keep: () => keepValue(match?.value), keepIn: (pasted) => keepValue(findSecret(pasted)?.value) };
}

// Takes the text out of the rich editor, wherever it sits in one run of text.
export function removeFromEditor(editor: Editor | null, value: string) {
  if (!editor) return;
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    const at = from < 0 && node.isText ? (node.text ?? "").indexOf(value) : -1;
    if (at >= 0) from = pos + at;
    return from < 0;
  });
  if (from >= 0) editor.chain().focus().deleteRange({ from, to: from + value.length }).run();
}

function SecretTypedBar({ match, onRemove, onKeep }: { match: SecretMatch | null; onRemove: (value: string) => void; onKeep: () => void }) {
  if (!match) return null;
  return (
    <Strip match={match}>
      <button type="button" onClick={() => onRemove(match.value)} className={`${STRIP_BUTTON} text-ink`}>
        Remove it
      </button>
      <button type="button" onClick={onKeep} className={STRIP_BUTTON}>
        Keep it
      </button>
    </Strip>
  );
}

// Both guards for one Composer: the paste guard, and the typed check fed the message's plain text.
export function useComposerSecrets() {
  const [plain, setPlain] = useState("");
  return { paste: useSecretPaste(), typed: useTypedSecret(plain), setPlain };
}

// The Composer's strip: a held paste first, else a secret found in the message. onInsert puts a paste you
// let through into whichever view is open; onRemove takes a found secret out of it.
export function SecretBars({
  guard,
  onInsert,
  onRemove,
}: {
  guard: ReturnType<typeof useComposerSecrets>;
  onInsert: (text: string) => void;
  onRemove: (value: string) => void;
}) {
  if (guard.paste.held)
    return (
      <SecretPasteBar
        guard={guard.paste}
        onPaste={(text) => {
          guard.typed.keepIn(text);
          onInsert(text);
        }}
      />
    );
  return <SecretTypedBar match={guard.typed.match} onKeep={guard.typed.keep} onRemove={onRemove} />;
}
