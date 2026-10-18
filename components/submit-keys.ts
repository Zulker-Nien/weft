import { Extension } from "@tiptap/react";
import { isMac } from "@/lib/hotkeys";

type Variant = "dialog" | "reply";
type Keys = { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean };

// The handlers a Composer was given, read at key-press time so a re-render's new ones are used.
export type Submitters = { submit: () => void; submitAlt?: () => void };

// What Enter does in the Markdown box: send, run the alternate send (⌃↵ on macOS, where ⌘ is the mod key),
// or nothing (a new line). ⌘↵ and Ctrl↵ always send; in a reply, Enter does too, unless Shift is held.
export function submitFor(e: Keys, variant: Variant, hasAlt: boolean, mac: boolean): "submit" | "alt" | null {
  if (e.key !== "Enter") return null;
  if (mac && e.ctrlKey && !e.metaKey && hasAlt) return "alt";
  return e.metaKey || e.ctrlKey || (variant === "reply" && !e.shiftKey) ? "submit" : null;
}

// The rich editor's submit keys: ⌘↵ sends; ⌃↵ runs the alternate on macOS; in a reply, Enter sends,
// except inside a list or code block, where it starts a new line.
export function submitKeys(variant: Variant, current: () => Submitters) {
  return Extension.create({
    name: "submitKeys",
    addKeyboardShortcuts() {
      return {
        "Mod-Enter": () => {
          current().submit();
          return true;
        },
        // Off macOS Ctrl is Mod, so this would shadow Mod-Enter.
        ...(isMac() && {
          "Ctrl-Enter": () => {
            const { submitAlt } = current();
            if (!submitAlt) return false;
            submitAlt();
            return true;
          },
        }),
        Enter: ({ editor: e }) => {
          if (variant !== "reply" || e.isActive("codeBlock") || e.isActive("listItem")) return false;
          current().submit();
          return true;
        },
      };
    },
  });
}

// ⌘B (Ctrl+B off macOS) in the New thread dialog adds the thread to the Backlog, ahead of the editor's bold.
export function isBacklogKey(e: Keys & { altKey: boolean }, mac: boolean): boolean {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b";
}
