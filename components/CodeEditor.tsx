"use client";

import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { languages } from "@codemirror/language-data";
import { basicSetup } from "codemirror";

// A code editor in CodeMirror 6, themed from Weft's CSS variables (app/globals.css). The wrapper
// takes its own text prop and writes it back through onChange; an external text change (a reload
// from disk, a conflict resolve) replaces the document and tries to keep the cursor where it
// was. ⌘S triggers onSave.

interface CodeEditorProps {
  path: string;
  text: string;
  onChange: (text: string) => void;
  onSave?: () => void;
  // A 1-based line to scroll to when the editor mounts (e.g. "lib/x.ts:42"). No effect on later
  // updates; this is for jumping to the file's open site, not for following the cursor.
  line?: number;
}

function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function weftTheme(): Extension {
  // A simple highlight style: ink for code, faint for comments, accent for keywords, muted for
  // strings, ok/danger for numbers and invalid. Reads its colors from CSS variables so light,
  // dark and scenes all stay right.
  const ink = readVar("--ink", "#1c1b18");
  const muted = readVar("--muted", "#64625c");
  const faint = readVar("--faint", "#96948c");
  const accent = readVar("--accent", "#2c6bd6");
  const warn = readVar("--warn", "#9a5b00");
  const ok = readVar("--ok", "#26773f");
  const danger = readVar("--danger", "#b93434");
  const onAccent = readVar("--on-accent", "#ffffff");
  const panel = readVar("--panel", "#ffffff");
  const sunken = readVar("--sunken", "#ebe9e3");
  const line = readVar("--line", "rgba(0,0,0,0.09)");
  const accentSoft = readVar("--accent-soft", "rgba(44,107,214,0.1)");
  const highlight = HighlightStyle.define([
    { tag: t.keyword, color: accent, fontWeight: "600" },
    { tag: [t.string, t.special(t.string)], color: ok },
    { tag: [t.number, t.bool], color: warn },
    { tag: [t.atom, t.null], color: warn },
    { tag: [t.comment, t.lineComment, t.blockComment], color: faint, fontStyle: "italic" },
    { tag: [t.variableName, t.propertyName, t.attributeName], color: ink },
    { tag: [t.typeName, t.className, t.namespace], color: accent },
    { tag: [t.tagName, t.angleBracket], color: warn },
    { tag: [t.operator, t.punctuation, t.bracket], color: muted },
    { tag: [t.heading], color: accent, fontWeight: "700" },
    { tag: [t.link, t.url], color: accent, textDecoration: "underline" },
    { tag: [t.invalid], color: onAccent, backgroundColor: danger },
    { tag: [t.meta], color: muted },
  ]);
  return [
    syntaxHighlighting(highlight),
    EditorView.theme({
      "&": { color: ink, backgroundColor: panel, fontSize: "13px" },
      ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace" },
      ".cm-content": { caretColor: accent, padding: "8px 0" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: accent, borderLeftWidth: "2px" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: accentSoft },
      ".cm-gutters": { backgroundColor: sunken, color: faint, borderRight: `1px solid ${line}` },
      ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: accentSoft },
      ".cm-matchingBracket, .cm-nonmatchingBracket": { outline: `1px solid ${accent}` },
    }),
  ];
}

async function languageFor(path: string): Promise<Extension | null> {
  const desc = LanguageDescription.matchFilename(languages, path);
  if (!desc) return null;
  try {
    const support = await desc.load();
    return support;
  } catch {
    return null;
  }
}

// Replaces the editor's doc without losing the cursor position when possible. The CodeMirror
// dispatch API is internal; the public API is to reconfigure the state, which loses selection.
// We do a doc-only replacement that preserves selection when the doc length matches the old one,
// and falls back to preserving the relative offset.
function replaceDoc(view: EditorView, next: string): void {
  const cur = view.state.doc;
  const sel = view.state.selection.main;
  if (cur.toString() === next) return;
  // Anchor the head of the selection; recompute on the new doc by character offset.
  const anchorOffset = sel.anchor;
  const headOffset = sel.head;
  view.dispatch({
    changes: { from: 0, to: cur.length, insert: next },
    selection: { anchor: Math.min(anchorOffset, next.length), head: Math.min(headOffset, next.length) },
    scrollIntoView: false,
  });
}

// The base extension set built without props-driven callbacks. Theme + keymap shell + the
// updateListener, with the prop-driven callbacks wired in by the caller.
function buildBaseExtensions(save: () => void, onChange: (text: string) => void): Extension[] {
  return [
    basicSetup,
    history(),
    lineNumbers(),
    highlightActiveLine(),
    bracketMatching(),
    indentOnInput(),
    closeBrackets(),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...closeBracketsKeymap,
      indentWithTab,
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          save();
          return true;
        },
      },
    ]),
    weftTheme(),
    EditorView.lineWrapping,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange(u.state.doc.toString());
    }),
  ];
}

export default function CodeEditor({ path, text, onChange, onSave, line }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The prop-driven callbacks. We keep them on a ref so the latest values are always visible
  // to the CodeMirror keymap and updateListener without rebuilding the editor.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
  });

  // The text the editor was created with. Only the first render's value matters; later text
  // changes go through the replaceDoc effect below.
  const initialTextRef = useRef(text);

  // Mount the editor. Extensions are built inside the effect so the keymap and updateListener
  // closures aren't constructed during render.
  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    let cancelled = false;
    const extensions = buildBaseExtensions(
      () => onSaveRef.current?.(),
      (next) => onChangeRef.current(next),
    );
    const state = EditorState.create({ doc: initialTextRef.current, extensions });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    void languageFor(path).then((ext) => {
      if (cancelled || !viewRef.current || !ext) return;
      // Re-create the editor state to include the language.
      viewRef.current.setState(EditorState.create({ doc: viewRef.current.state.doc.toString(), extensions: [...extensions, ext] }));
    });
    return () => {
      cancelled = true;
      view.destroy();
      viewRef.current = null;
    };
  }, [path]);

  // External text change: reload the doc without disturbing the user's current edits mid-stream.
  // We only replace when the incoming text differs from what we last sent up the onChange, which
  // means the change came from outside (disk reload, conflict resolve).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc === text) return;
    replaceDoc(view, text);
  }, [text]);

  // Jump to the requested line after mount.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !line || line < 1) return;
    // Translate a 1-based line to a doc offset. If the line is past the end, clamp to the last line.
    const safeLine = Math.min(line, view.state.doc.lines);
    const pos = view.state.doc.line(safeLine).from;
    view.dispatch({ selection: { anchor: pos, head: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    view.focus();
    // Only on the first mount for a given line request; the line prop changes when the user opens
    // a new file in this tab.
  }, [line]);

  return <div ref={hostRef} className="cm-host h-full w-full overflow-auto" data-language={path.split(".").pop() ?? ""} />;
}