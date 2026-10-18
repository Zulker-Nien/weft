"use client";

import type { EditPreview } from "@/lib/edit-preview";

// A compact line diff, no gutter, used both by the permission prompt and the tool row in the
// thread. Tinted rows (bg-ok-soft for +, bg-danger-soft for -) and a single "+N more lines" footer
// when the preview was capped. No line numbers (the editor column shows them).

const ROW: Record<string, string> = {
  "+": "bg-ok-soft text-ink",
  "-": "bg-danger-soft text-ink",
  " ": "text-muted",
};

const PRE = "max-h-36 overflow-auto rounded bg-panel/70 px-2 py-1.5 font-mono text-[11px]";

export function EditDiff({ edit }: { edit: EditPreview }) {
  return (
    <pre className={PRE} data-testid="edit-diff">
      {edit.lines.map((line, i) => (
        <div key={i} className={`whitespace-pre-wrap ${ROW[line.kind]}`}>
          <span className="select-none opacity-60">{line.kind} </span>
          {line.text || " "}
        </div>
      ))}
      {edit.more > 0 && <div className="text-faint">… {edit.more} more lines</div>}
    </pre>
  );
}
