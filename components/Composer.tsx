"use client";

import { Extension, EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { mediaMarkdown } from "@/lib/media";
import { useDictation } from "@/lib/use-dictation";
import Icon, { Spinner, type IconName } from "./Icon";
import { Media, insertFiles, pendingMedia } from "./MediaNode";

// The prompt box for new threads and replies: rich text that reads and writes Markdown, images and
// videos pasted or dropped right where they go, dictation, and a raw Markdown view.

export interface ComposerHandle {
  focus(): void;
  // The prompt as Markdown, or throws if an upload is still running or failed.
  read(): string;
  clear(): void;
  isEmpty(): boolean;
}

// Plain text that looks like Markdown is parsed as Markdown when pasted.
const LOOKS_LIKE_MARKDOWN = /^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|>\s|```)|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\n]+\)/m;

function seconds(total: number) {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function ToolButton({
  icon,
  label,
  active,
  onClick,
  disabled,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`rounded p-1.5 ${active ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"} disabled:opacity-40`}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

function FormatBar({ editor }: { editor: Editor }) {
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      heading: e.isActive("heading"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      link: e.isActive("link"),
    }),
  });
  const run = () => editor.chain().focus();
  function link() {
    if (on.link) {
      run().unsetLink().run();
      return;
    }
    const url = window.prompt("Link to", "https://");
    if (url && url !== "https://") run().extendMarkRange("link").setLink({ href: url }).run();
  }
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      <ToolButton icon="bold" label="Bold (⌘B)" active={on.bold} onClick={() => run().toggleBold().run()} />
      <ToolButton icon="italic" label="Italic (⌘I)" active={on.italic} onClick={() => run().toggleItalic().run()} />
      <ToolButton icon="strike" label="Strikethrough (⌘⇧S)" active={on.strike} onClick={() => run().toggleStrike().run()} />
      <ToolButton icon="code" label="Inline code (⌘E)" active={on.code} onClick={() => run().toggleCode().run()} />
      <ToolButton icon="link" label="Link" active={on.link} onClick={link} />
      <span className="mx-1 h-4 w-px bg-line" />
      <ToolButton icon="heading" label="Heading" active={on.heading} onClick={() => run().toggleHeading({ level: 2 }).run()} />
      <ToolButton icon="list" label="Bulleted list" active={on.bullet} onClick={() => run().toggleBulletList().run()} />
      <ToolButton icon="listOrdered" label="Numbered list" active={on.ordered} onClick={() => run().toggleOrderedList().run()} />
      <ToolButton icon="quote" label="Quote" active={on.quote} onClick={() => run().toggleBlockquote().run()} />
      <ToolButton icon="codeBlock" label="Code block" active={on.codeBlock} onClick={() => run().toggleCodeBlock().run()} />
    </div>
  );
}

function MicButton({ dictation }: { dictation: ReturnType<typeof useDictation> }) {
  const { state, level, seconds: elapsed } = dictation;
  const recording = state === "recording";
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={dictation.toggle}
      disabled={state === "transcribing"}
      aria-label={recording ? "Stop dictation" : "Dictate"}
      aria-pressed={recording}
      title={recording ? "Stop and insert the text (Esc cancels)" : "Dictate"}
      className={`relative flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[12px] ${
        recording ? "bg-danger text-white" : "text-muted hover:bg-sunken hover:text-ink"
      } disabled:opacity-60`}
    >
      {recording && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full bg-danger/40 transition-transform duration-75"
          style={{ transform: `scale(${1 + level * 0.45})` }}
        />
      )}
      <span className="relative flex items-center gap-1.5">
        {state === "transcribing" ? <Spinner size={12} /> : <Icon name={recording ? "stop" : "mic"} size={14} />}
        {recording && <span className="tabular-nums">{seconds(elapsed)}</span>}
        {state === "transcribing" && <span>Transcribing…</span>}
      </span>
    </button>
  );
}

const Composer = forwardRef<
  ComposerHandle,
  {
    // A draft to start from, as Markdown.
    initial?: string;
    placeholder: string;
    autoFocus?: boolean;
    // A reply box sends on Enter and keeps its formatting bar folded; a new thread sends on ⌘↵.
    variant: "dialog" | "reply";
    onSubmit: () => void;
    // Called with the Markdown as it changes, for saving drafts.
    onChange?: (markdown: string) => void;
    // Buttons at the right end of the bottom bar, such as Send.
    actions?: ReactNode;
    // The editing area's height, e.g. "min-h-[260px] max-h-[55vh]".
    sizeClass: string;
    // Classes for the outer frame, e.g. "flex-1" to fill a dialog.
    className?: string;
  }
>(function Composer({ initial = "", placeholder, autoFocus, variant, onSubmit, onChange, actions, sizeClass, className = "" }, ref) {
  const [source, setSource] = useState<string | null>(null);
  const [showFormat, setShowFormat] = useState(variant === "dialog");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sourceBox = useRef<HTMLTextAreaElement>(null);
  // The editor, for the paste and drop handlers, which are set up before it exists.
  const editorRef = useRef<Editor | null>(null);
  const onSubmitRef = useRef(onSubmit);
  const onChangeRef = useRef(onChange);
  const placeholderRef = useRef(placeholder);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
    onChangeRef.current = onChange;
  });

  const editor = useEditor({
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    content: initial,
    contentType: "markdown",
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Markdown has no underline.
        underline: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
      Markdown,
      Media,
      Extension.create({
        name: "submitKeys",
        addKeyboardShortcuts() {
          return {
            "Mod-Enter": () => {
              onSubmitRef.current();
              return true;
            },
            // In a reply, Enter sends, except inside a list or code block, where it starts a new line.
            Enter: ({ editor: e }) => {
              if (variant !== "reply" || e.isActive("codeBlock") || e.isActive("listItem")) return false;
              onSubmitRef.current();
              return true;
            },
          };
        },
      }),
    ],
    editorProps: {
      attributes: { class: `composer-content md-body outline-none px-3.5 py-3 ${sizeClass} overflow-y-auto` },
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const html = event.clipboardData?.getData("text/html") ?? "";
        // Copying a picture gives the file plus a scrap of HTML or alt text; copying from a
        // spreadsheet gives a picture of the cells plus the text, and the text is what's wanted.
        if (files.length && (!text.trim() || (html.includes("<img") && text.length < 300))) {
          if (editorRef.current) insertFiles(editorRef.current, files);
          return true;
        }
        if (!html && text && LOOKS_LIKE_MARKDOWN.test(text) && !editorRef.current?.isActive("codeBlock")) {
          editorRef.current?.chain().focus().insertContent(text, { contentType: "markdown" }).run();
          return true;
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (moved || !files.length || !editorRef.current) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        insertFiles(editorRef.current, files, pos);
        return true;
      },
    },
    onUpdate: ({ editor: e }) => onChangeRef.current?.(e.getMarkdown()),
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // The placeholder can change (a reply box while its thread works); redraw it when it does.
  useEffect(() => {
    placeholderRef.current = placeholder;
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta("placeholder", placeholder));
  }, [editor, placeholder]);

  const dictation = useDictation((text) => {
    if (source !== null) {
      insertIntoSource(text);
      return;
    }
    if (!editor) return;
    // Keep a space between dictated text and what's before it.
    const { from } = editor.state.selection;
    const before = editor.state.doc.textBetween(Math.max(0, from - 1), from, "\n", "\n");
    editor.chain().focus().insertContent(before && !/\s/.test(before) ? ` ${text}` : text).run();
  });

  function insertIntoSource(text: string) {
    const box = sourceBox.current;
    const current = source ?? "";
    const at = box ? box.selectionStart : current.length;
    const next = current.slice(0, at) + text + current.slice(box ? box.selectionEnd : at);
    setSource(next);
    onChangeRef.current?.(next);
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(at + text.length, at + text.length);
    });
  }

  // In the Markdown view, a pasted file is uploaded first and its Markdown inserted after.
  async function uploadIntoSource(files: File[]) {
    for (const file of files) {
      try {
        const saved = await api.uploadAttachment(file, file.name || "pasted-image.png");
        insertIntoSource(`${mediaMarkdown(file.name || saved.name, saved.path)}\n`);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err));
      }
    }
  }

  function toggleSource() {
    if (!editor) return;
    if (source === null) {
      setSource(editor.getMarkdown());
      requestAnimationFrame(() => sourceBox.current?.focus());
    } else {
      editor.commands.setContent(source, { contentType: "markdown" });
      setSource(null);
      requestAnimationFrame(() => editor.commands.focus("end"));
    }
  }

  useImperativeHandle(ref, () => ({
    focus: () => (source !== null ? sourceBox.current?.focus() : editor?.commands.focus("end")),
    read: () => {
      if (source !== null) return source.trim();
      if (!editor) return "";
      const { uploading, failed } = pendingMedia(editor);
      if (uploading) throw new Error(`Wait for ${uploading === 1 ? "the upload" : `${uploading} uploads`} to finish.`);
      if (failed) throw new Error("An attachment didn't upload. Remove it and paste it again.");
      return editor.getMarkdown().trim();
    },
    clear: () => {
      if (source !== null) setSource("");
      editor?.commands.clearContent(true);
    },
    isEmpty: () => (source !== null ? !source.trim() : (editor?.isEmpty ?? true)),
  }));

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape" && dictation.state === "recording") {
          e.stopPropagation();
          dictation.cancel();
        }
      }}
      onDragEnter={(e) => e.dataTransfer.types.includes("Files") && setDragging(true)}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={() => setDragging(false)}
      className={`composer relative flex min-h-0 flex-col rounded-lg border bg-canvas transition-colors focus-within:border-accent ${
        dragging ? "border-accent bg-accent-soft" : "border-line-strong"
      } ${className}`}
    >
      {showFormat && editor && source === null && (
        <div className="flex shrink-0 items-center border-b border-line px-1.5 py-1">
          <FormatBar editor={editor} />
        </div>
      )}

      {source !== null ? (
        <textarea
          ref={sourceBox}
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            onChangeRef.current?.(e.target.value);
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length && !e.clipboardData.getData("text/plain").trim()) {
              e.preventDefault();
              void uploadIntoSource(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey || (variant === "reply" && !e.shiftKey))) {
              e.preventDefault();
              onSubmitRef.current();
            }
          }}
          spellCheck={false}
          aria-label="Markdown"
          className={`w-full resize-none bg-transparent px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none ${sizeClass}`}
        />
      ) : (
        <EditorContent editor={editor} className="min-h-0 flex-1 overflow-hidden" />
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg text-[13px] font-medium text-accent">
          Drop images or videos to add them here
        </div>
      )}

      <div className="flex shrink-0 items-center gap-0.5 px-1.5 pb-1.5 pt-0.5">
        <ToolButton icon="paperclip" label="Attach images, videos, or files" onClick={() => fileInput.current?.click()} />
        <MicButton dictation={dictation} />
        {variant === "reply" && source === null && (
          <ToolButton icon="heading" label="Formatting" active={showFormat} onClick={() => setShowFormat(!showFormat)} />
        )}
        <ToolButton
          icon="markdown"
          label={source === null ? "Edit as Markdown" : "Back to formatted text"}
          active={source !== null}
          onClick={toggleSource}
        />
        <span className="min-w-0 flex-1 truncate px-1.5 text-[11.5px]">
          {dictation.error ? (
            <button type="button" onClick={dictation.clearError} className="text-danger" title="Dismiss">
              {dictation.error}
            </button>
          ) : dictation.state === "recording" ? (
            <span className="text-muted">Listening… click the mic again to insert the text</span>
          ) : null}
        </span>
        {actions}
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (!files.length) return;
          if (source !== null) void uploadIntoSource(files);
          else if (editor) insertFiles(editor, files);
        }}
      />
    </div>
  );
});

export default Composer;
