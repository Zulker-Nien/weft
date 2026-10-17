"use client";

import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { unifiedMergeView } from "@codemirror/merge";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { basicSetup } from "codemirror";

// The "Changes" mode of a code tab: a unified diff against git HEAD, editable, with a per-chunk
// accept/reject control so the user can keep the file in lockstep with the working copy or pull
// pieces of HEAD back. The merge view treats the right-hand side (the editor) as the editable
// document and the left-hand side (the `original`) as HEAD; the rendered output is the union of
// both, with inserted/deleted/inline-change markings.

interface DiffEditorProps {
  path: string;
  text: string;
  // The file as git HEAD has it; null when untracked or the folder isn't a git repo.
  headText: string | null;
  onChange: (text: string) => void;
  onSave?: () => void;
}

function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function weftMergeTheme(): Extension {
  const ink = readVar("--ink", "#1c1b18");
  const muted = readVar("--muted", "#64625c");
  const faint = readVar("--faint", "#96948c");
  const accent = readVar("--accent", "#2c6bd6");
  const ok = readVar("--ok", "#26773f");
  const okSoft = readVar("--ok-soft", "rgba(38,119,63,0.11)");
  const danger = readVar("--danger", "#b93434");
  const dangerSoft = readVar("--danger-soft", "rgba(185,52,52,0.1)");
  const panel = readVar("--panel", "#ffffff");
  const sunken = readVar("--sunken", "#ebe9e3");
  const line = readVar("--line", "rgba(0,0,0,0.09)");
  return EditorView.theme({
    "&": { color: ink, backgroundColor: panel, fontSize: "13px" },
    ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace" },
    ".cm-content": { caretColor: accent, padding: "8px 0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: accent, borderLeftWidth: "2px" },
    ".cm-gutters": { backgroundColor: sunken, color: faint, borderRight: `1px solid ${line}` },
    // Inserted line (the user's addition vs HEAD): soft green.
    ".cm-merge-inset": { backgroundColor: okSoft },
    ".cm-merge-inset-edge": { borderLeft: `2px solid ${ok}` },
    // Deleted line (HEAD had it, file doesn't): soft red.
    ".cm-merge-deleted": { backgroundColor: dangerSoft, color: muted, textDecoration: "line-through" },
    ".cm-merge-deleted-edge": { borderLeft: `2px solid ${danger}` },
    // A chunk control: accept/reject on the gutter.
    ".cm-merge-buttons": { color: faint, backgroundColor: panel },
  });
}

async function languageFor(path: string): Promise<Extension | null> {
  const desc = LanguageDescription.matchFilename(languages, path);
  if (!desc) return null;
  try {
    return await desc.load();
  } catch {
    return null;
  }
}

// Base extension set without the merge view (which needs the `original` HEAD text) or the
// prop-driven callbacks. Built outside render so the keymap and updateListener closures don't
// trigger the refs-during-render rule.
function buildBaseExtensions(save: () => void, onChange: (text: string) => void): Extension[] {
  return [
    basicSetup,
    history(),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      { key: "Mod-s", preventDefault: true, run: () => { save(); return true; } },
    ]),
    weftMergeTheme(),
    EditorView.lineWrapping,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange(u.state.doc.toString());
    }),
  ];
}

export default function DiffEditor({ path, text, headText, onChange, onSave }: DiffEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The prop-driven callbacks. Kept on a ref so the latest values are visible to the CodeMirror
  // keymap and updateListener without rebuilding the editor.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
  });
  // The text the editor was created with; later text changes go through the effect below.
  const initialTextRef = useRef(text);
  // `original` is what HEAD has. For an untracked file we still pass an empty string — the diff is
  // "everything is added" — and the merge view handles it cleanly. Kept on a ref so the mount and
  // reload effects always see the latest HEAD without re-creating the editor.
  const originalRef = useRef<string>(text);
  useEffect(() => {
    originalRef.current = headText ?? "";
  });

  // Mount the editor. Extensions are built inside the effect so closures don't run during render.
  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    let cancelled = false;
    const baseExtensions = buildBaseExtensions(
      () => onSaveRef.current?.(),
      (next) => onChangeRef.current(next),
    );
    const state = EditorState.create({ doc: initialTextRef.current, extensions: baseExtensions });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    void languageFor(path).then((lang) => {
      if (cancelled || !viewRef.current) return;
      const merge = unifiedMergeView({ original: originalRef.current, mergeControls: true, collapseUnchanged: { margin: 3, minSize: 4 } });
      // Re-create state to include the language (if any) and the merge view together.
      const exts = [...baseExtensions, merge];
      if (lang) exts.push(lang);
      viewRef.current.setState(EditorState.create({ doc: viewRef.current.state.doc.toString(), extensions: exts }));
    });
    return () => {
      cancelled = true;
      view.destroy();
      viewRef.current = null;
    };
  }, [path]);

  // External text change (a reload, a save). We rebuild the merge view's state so its `original`
  // tracks HEAD (which is the only thing the user can't change here).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === text) return;
    const merge = unifiedMergeView({ original: originalRef.current, mergeControls: true, collapseUnchanged: { margin: 3, minSize: 4 } });
    view.setState(EditorState.create({ doc: text, extensions: [...buildBaseExtensions(() => onSaveRef.current?.(), (next) => onChangeRef.current(next)), merge] }));
  }, [text]);

  return <div ref={hostRef} className="cm-host h-full w-full overflow-auto" data-mode="diff" data-language={path.split(".").pop() ?? ""} />;
}

// A small wrapper component that shows the "no changes vs HEAD" / "untracked" states. The
// `DiffEditor` is the editable view; this is the empty-state.
export function DiffEmpty({ state }: { state: "no-changes" | "untracked" | "loading" }) {
  const message = state === "no-changes" ? "No changes vs HEAD." : state === "untracked" ? "Untracked file — the diff is everything." : "Loading…";
  return (
    <div className="flex h-full items-center justify-center text-[13px] text-muted">
      <div className="rounded-md border border-line bg-sunken px-3 py-2">{message}</div>
    </div>
  );
}
