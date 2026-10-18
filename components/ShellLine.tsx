import type { ThreadItem } from "@/lib/types";
import { Spinner } from "./Icon";

// A "!" command you ran from the reply box (lib/shell.ts): the command, what it printed, and whether
// Claude has read it yet.
export default function ShellLine({ item }: { item: Extract<ThreadItem, { kind: "shell" }> }) {
  const running = item.ms === undefined;
  const failed = item.timedOut || (item.exitCode ?? 0) !== 0;
  return (
    <div className="ml-10 overflow-hidden rounded-lg border border-line bg-sunken">
      <div className="flex items-center gap-2 px-2.5 py-1.5 font-mono text-[12px]">
        <span className="font-semibold text-warn">!</span>
        <span className="min-w-0 flex-1 break-all text-ink">{item.command}</span>
        {running && <Spinner size={10} />}
      </div>
      {item.output && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-line px-2.5 py-2 font-mono text-[11.5px] leading-snug text-muted">
          {item.output}
        </pre>
      )}
      {!running && (
        <div className="flex gap-2 border-t border-line px-2.5 py-1 text-[11px] text-faint">
          <span className={failed ? "text-danger" : undefined}>
            {item.timedOut ? "Stopped after 2 minutes" : item.exitCode === null ? "Couldn't run" : `Exit ${item.exitCode}`}
          </span>
          <span>{seconds(item.ms ?? 0)}</span>
          <span className="ml-auto">{item.sent ? "Sent to Claude" : "Goes to Claude with your next message"}</span>
        </div>
      )}
    </div>
  );
}

function seconds(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
