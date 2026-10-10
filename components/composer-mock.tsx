// A stand-in for Composer in component tests: the real one is a TipTap editor, which jsdom can't type
// into reliably. Same handle and props; a plain textarea where Enter submits and Shift+Enter is a
// newline, as Composer's own keymap does.
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from "react";
import type { ComposerHandle } from "./Composer";

const ComposerMock = forwardRef<
  ComposerHandle,
  { initial?: string; placeholder?: string; onSubmit: () => void; onChange?: (markdown: string) => void; actions?: ReactNode }
>(function ComposerMock({ initial, placeholder, onSubmit, onChange, actions }, ref) {
  const box = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({
    focus: () => box.current?.focus(),
    read: () => box.current?.value.trim() ?? "",
    clear: () => {
      if (box.current) box.current.value = "";
    },
    write: (markdown) => {
      if (box.current) box.current.value = markdown;
    },
    isEmpty: () => !box.current?.value.trim(),
  }));
  return (
    <div>
      <textarea
        ref={box}
        aria-label="Message"
        placeholder={placeholder}
        defaultValue={initial}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      {actions}
    </div>
  );
});

export default ComposerMock;
