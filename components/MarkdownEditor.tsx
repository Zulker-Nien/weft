"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { preserveFormatting } from "@/lib/markdown-preserve";

// A markdown WYSIWYG (TipTap with @tiptap/markdown) with a Source toggle. The editor's serialized
// markdown goes to onChange for the live preview and dirty state; when saving, the parent uses
// preserveFormatting to merge against the editor's baseline round-trip, so untouched lines keep
// the file's exact bytes.

interface MarkdownEditorProps {
  path: string;
  text: string;
  // The editor's first round-tripped view of the file (taken right after mount). Used as the
  // baseline for preserveFormatting on save.
  baseline: string;
  // Called on every edit with the live markdown.
  onChange: (text: string) => void;
  onSave?: () => void;
}

export default function MarkdownEditor({ path, text, baseline, onChange, onSave }: MarkdownEditorProps) {
  // Source mode is a separate edit experience: a plain textarea, no TipTap. The textarea is
  // controlled by `text` directly so external reloads stay in sync without a sync effect.
  const [sourceMode, setSourceMode] = useState(false);
  const baselineRef = useRef(baseline);
  useEffect(() => {
    baselineRef.current = baseline;
  }, [baseline]);

  const editor = useEditor({
    immediatelyRender: false,
    autofocus: false,
    content: text,
    contentType: "markdown",
    extensions: useMemo(
      () => [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          // The composer (components/Composer.tsx) disables underline; match.
          underline: false,
          link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
        }),
        Markdown,
        TableKit.configure({ table: { resizable: true, allowTableNodeSelection: true } }),
      ],
      [],
    ),
    editorProps: {
      attributes: {
        class: "md-body md-editor outline-none px-3.5 py-3 min-h-[200px]",
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange(e.getMarkdown());
    },
  });

  // Pull external text changes (a reload, a conflict resolve) into the editor; the doc replaces
  // what the user is looking at. The cursor jumps to the start, which is the right default for a
  // disk reload — the user's edit was just overruled. The textarea in source mode is controlled
  // by `text` directly, so no sync is needed there.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = editor.getMarkdown();
    if (current === text) return;
    editor.commands.setContent(text, { contentType: "markdown" });
  }, [text, editor]);

  // When the user opens a different file in this tab, also rebaseline the round-trip baseline.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    baselineRef.current = editor.getMarkdown();
  }, [path, editor]);

  // ⌘S in source mode triggers a save through the same merged-text path.
  function onSourceKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave?.();
    }
  }

  function toggleSource() {
    if (!editor || editor.isDestroyed) return;
    if (sourceMode) {
      // Back to the WYSIWYG: the editor takes the textarea's current value (which is `text`).
      editor.commands.setContent(text, { contentType: "markdown" });
      setSourceMode(false);
      requestAnimationFrame(() => editor.commands.focus("end"));
    } else {
      // To source: nothing to seed — the textarea reads `text` directly.
      setSourceMode(true);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line bg-panel px-2 py-1 text-[12px] text-muted">
        <button
          type="button"
          onClick={toggleSource}
          className="rounded px-2 py-0.5 hover:bg-sunken hover:text-ink"
          aria-pressed={sourceMode}
        >
          {sourceMode ? "Edit" : "Source"}
        </button>
        {onSave && (
          <button
            type="button"
            onClick={() => onSave()}
            className="rounded px-2 py-0.5 hover:bg-sunken hover:text-ink"
            title="Save (⌘S)"
          >
            Save
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-canvas">
        {sourceMode ? (
          <textarea
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onSourceKey}
            className="h-full w-full resize-none border-0 bg-canvas px-3.5 py-3 font-mono text-[13px] text-ink outline-none"
            spellCheck={false}
          />
        ) : (
          <EditorContent editor={editor} className="h-full" />
        )}
      </div>
    </div>
  );
}

// The merged save target: the editor's live markdown, but only the lines the user changed vs the
// baseline replace the original file's bytes. The "original" the merge sees is `text` (the
// file's bytes as last read). This is a pure function the parent can call directly.
export function mergeMarkdownSave(fileText: string, baseline: string, edited: string): string {
  return preserveFormatting(fileText, baseline, edited);
}

// Re-exports the editor instance getter for tests; not used at runtime.
export function _editorMarkdown(editor: Editor | null): string {
  return editor && !editor.isDestroyed ? editor.getMarkdown() : "";
}
