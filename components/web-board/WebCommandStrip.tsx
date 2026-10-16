"use client";

// Under the header: the threads you asked your Mac to start that haven't turned up as cards yet, or failed.
// A pending or claimed one can be taken back; a failed one is cleared. Done ones are gone: the card is the answer.
import { isOpenCommand, type CloudCommandRow } from "@/lib/cloud-commands";
import { commandLine } from "@/lib/web-commands";

export function WebCommandStrip({ commands, onDrop }: { commands: CloudCommandRow[]; onDrop: (id: string) => void }) {
  const shown = commands.filter((c) => isOpenCommand(c) || c.status === "failed");
  if (!shown.length) return null;
  return (
    <ul className="mx-3 mt-2 flex shrink-0 flex-col gap-1" aria-label="Threads sent to your Mac">
      {shown.map((c) => {
        const { title, note } = commandLine(c);
        const failed = c.status === "failed";
        return (
          <li key={c.id} className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-[12.5px] ${failed ? "border-warn text-warn" : "border-line-strong text-muted"}`}>
            <span className="min-w-0 truncate font-medium text-ink">{title}</span>
            <span className="min-w-0 flex-1 truncate">{note}</span>
            <button onClick={() => onDrop(c.id)} className="shrink-0 rounded px-1.5 py-0.5 hover:bg-sunken hover:text-ink">
              {failed ? "Dismiss" : "Cancel"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
