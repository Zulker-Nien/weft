// The rich-text toolbar that sits above the editor in the Composer. Bold/italic/strike/code/link,
// a separator, then heading/lists/quote/code-block.
import { useEditorState, type Editor } from "@tiptap/react";
import Tip from "./Tip";
import Icon, { type IconName } from "./Icon";

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
    <Tip text={label} className="inline-flex">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        className={`rounded p-1.5 ${active ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"} disabled:opacity-40`}
      >
        <Icon name={icon} size={14} />
      </button>
    </Tip>
  );
}

export default function ComposerFormatBar({ editor }: { editor: Editor }) {
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
      <ToolButton
        icon="strike"
        label="Strikethrough (⌘⇧S)"
        active={on.strike}
        onClick={() => run().toggleStrike().run()}
      />
      <ToolButton icon="code" label="Inline code (⌘E)" active={on.code} onClick={() => run().toggleCode().run()} />
      <ToolButton icon="link" label="Link" active={on.link} onClick={link} />
      <span className="mx-1 h-4 w-px bg-line" />
      <ToolButton
        icon="heading"
        label="Heading"
        active={on.heading}
        onClick={() => run().toggleHeading({ level: 2 }).run()}
      />
      <ToolButton icon="list" label="Bulleted list" active={on.bullet} onClick={() => run().toggleBulletList().run()} />
      <ToolButton
        icon="listOrdered"
        label="Numbered list"
        active={on.ordered}
        onClick={() => run().toggleOrderedList().run()}
      />
      <ToolButton icon="quote" label="Quote" active={on.quote} onClick={() => run().toggleBlockquote().run()} />
      <ToolButton
        icon="codeBlock"
        label="Code block"
        active={on.codeBlock}
        onClick={() => run().toggleCodeBlock().run()}
      />
    </div>
  );
}