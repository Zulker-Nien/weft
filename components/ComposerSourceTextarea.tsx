// The plain-Markdown view of the Composer: a textarea that mirrors what the rich editor would
// serialize to, with the same Enter-to-submit keymap. A pasted file here uploads and inserts as
// Markdown rather than as a TipTap node.
import { type RefObject } from "react";
import { isMac } from "@/lib/hotkeys";
import { submitFor } from "./submit-keys";
import type { SecretPasteGuard } from "./SecretPaste";

export default function ComposerSourceTextarea({
  sourceBox,
  value,
  onChange,
  sizeClass,
  variant,
  hasAlt,
  onSubmitRef,
  onSubmitAltRef,
  secrets,
  uploadIntoSource,
}: {
  sourceBox: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  sizeClass: string;
  variant: "dialog" | "reply";
  hasAlt: boolean;
  onSubmitRef: RefObject<(() => void) | undefined>;
  onSubmitAltRef: RefObject<(() => void) | undefined>;
  secrets: { paste: SecretPasteGuard };
  uploadIntoSource: (files: File[]) => Promise<void>;
}) {
  return (
    <textarea
      ref={sourceBox}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPaste={(e) => {
        if (secrets.paste.hold(e.clipboardData.getData("text/plain"))) {
          e.preventDefault();
          return;
        }
        const files = [...e.clipboardData.files];
        if (files.length && !e.clipboardData.getData("text/plain").trim()) {
          e.preventDefault();
          void uploadIntoSource(files);
        }
      }}
      onKeyDown={(e) => {
        const send = submitFor(e, variant, hasAlt, isMac());
        if (!send) return;
        e.preventDefault();
        (send === "alt" ? onSubmitAltRef : onSubmitRef).current?.();
      }}
      spellCheck={false}
      aria-label="Markdown"
      className={`w-full resize-none bg-transparent px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none ${sizeClass}`}
    />
  );
}
