"use client";

import { memo, useState } from "react";
import { describeToolRun, formatCost, shortToolName, toolAction } from "@/lib/format";
import type { ThreadItem } from "@/lib/types";
import Icon, { Spinner } from "./Icon";
import Markdown from "./Markdown";
import MediaView from "./MediaView";

type ToolCall = Extract<ThreadItem, { kind: "tool" }>;
type Permission = Extract<ThreadItem, { kind: "permission" }>;

// What a thread shows: a message, or a run of tool calls between messages, folded into one line.
// key is the index of the first thread item in it, so it stays put as the run grows.
export type Entry =
  | { kind: "item"; item: ThreadItem; key: number }
  | { kind: "tools"; calls: (ToolCall | Permission)[]; key: number };

// Tool calls, and the permission requests they made, fold together. An answered question stays out,
// since its answer is part of the conversation.
export function groupThread(items: ThreadItem[]): Entry[] {
  const entries: Entry[] = [];
  items.forEach((item, key) => {
    if (!item) return;
    const folds = item.kind === "tool" || (item.kind === "permission" && !item.answer);
    const last = entries[entries.length - 1];
    if (!folds) entries.push({ kind: "item", item, key });
    else if (last?.kind === "tools") last.calls.push(item);
    else entries.push({ kind: "tools", calls: [item], key });
  });
  return entries;
}

function PermissionLine({ item }: { item: Permission }) {
  return (
    <div className="flex items-start gap-2 text-[12px]">
      <Icon name="lock" size={12} className={`mt-0.5 ${item.decision ? "text-faint" : "text-warn"}`} />
      <span className="min-w-0 flex-1 text-muted">{item.title}</span>
      <span className={item.decision === "allow" ? "text-ok" : item.decision === "deny" ? "text-danger" : "text-warn"}>
        {item.answer
          ? `Answered: ${item.answer}`
          : item.decision === "allow"
            ? "Allowed"
            : item.decision === "deny"
              ? "Denied"
              : "Waiting for you"}
      </span>
    </div>
  );
}

function ToolLine({ item, live }: { item: ToolCall; live: boolean }) {
  return (
    <details className="rounded-md border border-line bg-sunken">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-[12px]">
        <Icon name="wrench" size={12} className="text-faint" />
        <span className="shrink-0 font-mono font-medium text-ink">{shortToolName(item.name)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-muted">{item.summary}</span>
        {item.result === undefined ? (
          live && <span className="text-faint"><Spinner size={10} /></span>
        ) : item.isError ? (
          <span className="text-danger">failed</span>
        ) : null}
      </summary>
      {item.result && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-line px-2.5 py-2 font-mono text-[11.5px] leading-snug text-muted">
          {item.result}
        </pre>
      )}
      {item.images && (
        <div className="flex flex-wrap gap-2 border-t border-line p-2">
          {item.images.map((src) => (
            <MediaView key={src} src={src} alt="Screenshot" thumb={item.images!.length > 1} />
          ))}
        </div>
      )}
    </details>
  );
}

// A run of tool calls as one line, "Ran 3 commands, read 2 files, edited a file +1", that opens to
// show each call. Screenshots the run took stay visible while it's folded.
export function ToolRun({ calls, live }: { calls: (ToolCall | Permission)[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const tools = calls.filter((c): c is ToolCall => c.kind === "tool");
  if (!tools.length) return calls.map((c, i) => <PermissionLine key={i} item={c as Permission} />);

  const { text, more } = describeToolRun(tools.map((t) => ({ action: t.action ?? toolAction(t.name), target: t.summary })));
  const running = live ? tools.find((t) => t.result === undefined) : undefined;
  const failed = tools.filter((t) => t.isError).length;
  const denied = calls.filter((c) => c.kind === "permission" && c.decision === "deny").length;
  const waiting = calls.some((c) => c.kind === "permission" && !c.decision);
  const images = [...new Set(tools.flatMap((t) => t.images ?? []))];

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex max-w-full items-center gap-1.5 text-left text-[12.5px] text-muted hover:text-ink"
      >
        {running && <Spinner size={10} />}
        <span className="truncate">
          {text}
          {more > 0 && <span className="text-faint"> +{more}</span>}
        </span>
        {failed > 0 && <span className="shrink-0 text-danger">· {failed} failed</span>}
        {denied > 0 && <span className="shrink-0 text-danger">· {denied} denied</span>}
        {waiting && <span className="shrink-0 text-warn">· waiting for you</span>}
        <Icon name="chevronRight" size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {running && !open && (
        <div className="mt-0.5 truncate pl-4 font-mono text-[11.5px] text-faint">
          {shortToolName(running.name)} {running.summary}
        </div>
      )}
      {open ? (
        <div className="mt-2 flex flex-col gap-1.5 border-l-2 border-line pl-3">
          {calls.map((c, i) =>
            c.kind === "tool" ? <ToolLine key={c.id || i} item={c} live={live} /> : <PermissionLine key={i} item={c} />,
          )}
        </div>
      ) : (
        images.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {images.map((src) => (
              <MediaView key={src} src={src} alt="Screenshot" thumb={images.length > 1} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

// One message or marker in a thread. Items don't change once written, so a re-render while the
// agent streams skips them.
export const ThreadMessage = memo(function ThreadMessage({ item }: { item: ThreadItem }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="ml-10 rounded-lg bg-accent-soft px-3 py-2">
          <Markdown text={item.text} />
        </div>
      );
    case "assistant":
      return <Markdown text={item.text} />;
    case "tool":
      return <ToolLine item={item} live={false} />;
    case "permission":
      return <PermissionLine item={item} />;
    case "result": {
      const cost = formatCost(item.costUsd);
      return (
        <div className="flex items-center gap-2 py-1 text-[11px] text-faint">
          <div className="h-px flex-1 bg-line" />
          {item.isError ? (
            <span className="text-danger">{item.text}</span>
          ) : (
            <span>{item.text === "Stopped" ? "Stopped" : "Turn finished"}</span>
          )}
          {cost && <span>· {cost} so far</span>}
          <div className="h-px flex-1 bg-line" />
        </div>
      );
    }
  }
});
