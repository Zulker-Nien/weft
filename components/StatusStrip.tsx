"use client";

import Tip from "./Tip";
import { folderName, formatReset, formatTokens } from "@/lib/format";
import type { Backend, CardStats, LimitWindow } from "@/lib/types";

// Green while plenty is left, then warn, then danger (same cut-offs as the terminal statusline).
function tone(left: number) {
  return left >= 60 ? "text-ok" : left >= 30 ? "text-warn" : "text-danger";
}

function Limit({
  label,
  name,
  window,
}: {
  label: string;
  name: string;
  window?: LimitWindow;
}) {
  if (!window) return null;
  const left = Math.max(0, 100 - window.used);
  const reset = window.resetsAt
    ? `Resets ${new Date(window.resetsAt * 1000).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" })}.`
    : "";
  return (
    <Tip text={`${name}: ${left}% left (${window.used}% used). ${reset}`.trim()}>
      {label}:<span className={tone(left)}>{left}%</span>
      {window.resetsAt && (
        <span className="text-faint">
          {" "}
          reset {formatReset(window.resetsAt)}
        </span>
      )}
    </Tip>
  );
}

// Session numbers for the open thread: model, context left, tokens, changed lines, plan limits.
export default function StatusStrip({
  stats = {},
  cwd,
  backend,
  className = "",
}: {
  stats?: CardStats;
  cwd?: string;
  // Which CLI the thread runs on, so the model label knows whether to say "claude-…" or "puku".
  backend?: Backend;
  className?: string;
}) {
  if (!stats && !cwd && !backend) return null;
  const left =
    stats.contextUsed === undefined ? undefined : 100 - stats.contextUsed;
  const hasLines = Boolean(stats.added || stats.removed);
  const limits = stats.fiveHour || stats.sevenDay;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-0.5 font-mono text-[11px] text-muted ${className}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 whitespace-nowrap">
        {cwd && (
          <Tip text={stats.branch ? `${cwd} on branch ${stats.branch}` : cwd}>
            <span className="text-ok">{folderName(cwd)}</span>
            {stats.branch && <span className="text-accent"> ({stats.branch})</span>}
          </Tip>
        )}
        {stats.model && (
          <Tip text={`Model: ${stats.model}`}>
            <span className={backend === "puku" ? "text-puku" : "text-warn"}>[{stats.model.replace(/^claude-/, "")}]</span>
          </Tip>
        )}
        {/* Puku forwards a model name through the SDK only on some turns; when it doesn't, show
            the backend so the strip isn't blank. */}
        {backend === "puku" && !stats.model && (
          <Tip text="Backend: puku-cli">
            <span className="text-puku">[puku]</span>
          </Tip>
        )}
        {left !== undefined && (
          <Tip text={`Context window: ${left}% left (${stats.contextUsed}% filled by the last request). Near zero the thread is compacted or loses detail.`}>
            ctx:<span className={tone(left)}>{left}%</span>
          </Tip>
        )}
        {stats.tokens && (
          <Tip text={`${stats.tokens.toLocaleString()} input and output tokens used in this thread`}>
            tok:{formatTokens(stats.tokens)}
          </Tip>
        )}
        {hasLines && (
          <Tip text={`Uncommitted changes in the folder vs HEAD: ${stats.added} lines added, ${stats.removed} removed`}>
            <span className="text-ok">+{stats.added}</span>/
            <span className="text-danger">-{stats.removed}</span>
          </Tip>
        )}
        {limits && (
          <>
            <Limit label="5hr" name="5-hour plan limit" window={stats.fiveHour} />
            <Limit label="7d" name="Weekly plan limit" window={stats.sevenDay} />
          </>
        )}
      </div>
    </div>
  );
}
