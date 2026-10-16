"use client";

// The board's bottom-left toast: a single message (with an optional action like Undo), and a close
// button. Errors get a red border; messages with an action look like a neutral notice.
import Icon from "./Icon";

export interface BoardToastProps {
  text: string;
  // The action button (label + run); when present the toast wears the neutral border.
  action?: { label: string; run: () => void };
  onDismiss: () => void;
}

export default function BoardToast({ text, action, onDismiss }: BoardToastProps) {
  return (
    <div
      className={`fixed bottom-4 left-4 z-50 flex max-w-md items-start gap-2 rounded-lg border bg-panel px-3.5 py-2.5 text-[13px] text-ink shadow-lg ${action ? "border-line" : "border-danger/30"}`}
    >
      {action ? (
        <Icon name="archive" size={15} className="mt-0.5 text-muted" />
      ) : (
        <Icon name="alert" size={15} className="mt-0.5 text-danger" />
      )}
      <span className="flex-1">{text}</span>
      {action && (
        <button onClick={action.run} className="font-medium text-accent hover:underline">
          {action.label}
        </button>
      )}
      <button onClick={onDismiss} aria-label="Dismiss" className="text-muted hover:text-ink">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
