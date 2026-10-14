"use client";

import Tip from "./Tip";
import { cacheMinutesLeft, folderName, formatReset, formatTokens } from "@/lib/format";
import { BACKEND_LABELS, type Backend, type CacheState, type CardStats, type LimitWindow } from "@/lib/types";
import { useNow } from "@/lib/use-now";

// Green while plenty is left, then warn, then danger (same cut-offs as the terminal statusline).
function tone(left: number) {
  return left >= 60 ? "text-ok" : left >= 30 ? "text-warn" : "text-danger";
}

function modelTone(backend?: Backend) {
  if (backend === "puku") return "text-puku";
  if (backend === "codex") return "text-accent";
  return "text-warn";
}

function BackendFallback({ backend }: { backend: Backend }) {
  const name = backend === "puku" ? "puku" : "Codex";
  return (
    <Tip text={`Backend: ${BACKEND_LABELS[backend]}`}>
      <span className={modelTone(backend)}>[{name}]</span>
    </Tip>
  );
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

// How long the prompt cache stays warm, or "cold" with what the next message sends again at full price.
function Cache({ cache }: { cache?: CacheState }) {
  const now = useNow();
  if (!cache || !now) return null;
  const minutes = cacheMinutesLeft(cache, now);
  const size = formatTokens(cache.tokens);
  const life = cache.ttl >= 3600 ? "an hour" : `${Math.round(cache.ttl / 60)} minutes`;
  if (!minutes) {
    return (
      <Tip text={`Prompt cache gone cold: it lasts ${life} after the last request. Your next message sends this thread's ${size} tokens again at full price instead of about a tenth, which takes a bigger bite of the 5-hour limit. For a new topic, a fresh card is cheaper.`}>
        cache:<span className="text-warn">cold {size}</span>
      </Tip>
    );
  }
  return (
    <Tip text={`Prompt cache warm for ${minutes} more min (it lasts ${life} after each request). The last request read ${cache.hit}% of its ${size} tokens from cache, at about a tenth of the price. Reply before it runs out to keep it cheap.`}>
      cache:<span className="text-ok">{minutes}m</span>
    </Tip>
  );
}

// Session numbers for the open thread: model, context left, cache, tokens, plan limits. The folder's
// uncommitted lines moved to the header (components/PileBadge.tsx).
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
  const left =
    stats.contextUsed === undefined ? undefined : 100 - stats.contextUsed;
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
            <span className={modelTone(backend)}>[{stats.model.replace(/^claude-/, "")}]</span>
          </Tip>
        )}
        {backend && !stats.model && backend !== "claude" && <BackendFallback backend={backend} />}
        {left !== undefined && (
          <Tip text={`Context window: ${left}% left (${stats.contextUsed}% filled by the last request). Near zero the thread is compacted or loses detail.`}>
            ctx:<span className={tone(left)}>{left}%</span>
          </Tip>
        )}
        <Cache cache={stats.cache} />
        {stats.tokens && (
          <Tip text={`${stats.tokens.toLocaleString()} input and output tokens used in this thread`}>
            tok:{formatTokens(stats.tokens)}
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
