"use client";

import { memo, useState } from "react";
import { describeToolRun, shortToolName, toolAction } from "@/lib/format";
import { turnId } from "@/lib/glance-rail";
import type { ThreadItem } from "@/lib/types";
import CrashGuard from "./CrashGuard";
import Icon, { Spinner } from "./Icon";
import Markdown from "./Markdown";
import MediaView from "./MediaView";
import SecretAskInput from "./SecretAskInput";

type ToolCall = Extract<ThreadItem, { kind: "tool" }>;
type Permission = Extract<ThreadItem, { kind: "permission" }>;

// What a thread shows: a message, or a run of tool calls between messages, folded into one line.
// key is the index of the first thread item in it, so it stays put as the run grows.
export type Entry =
  | { kind: "item"; item: ThreadItem; key: number }
  | { kind: "tools"; calls: (ToolCall | Permission)[]; key: number };

// Tool calls, and the permission requests they made, fold together. An answered question stays out,
// since its answer is part of the conversation.
// A stored thread can hold a null hole, so items are checked one by one.
export function groupThread(items: readonly (ThreadItem | null | undefined)[]): Entry[] {
  const entries: Entry[] = [];
  items.forEach((item, key) => {
    if (!item) return;
    // A thread's ask for a key stays out too: it's an input the user fills in (SecretAskInput).
    const folds = (item.kind === "tool" && !item.ask) || (item.kind === "permission" && !item.answer);
    const last = entries[entries.length - 1];
    if (!folds) entries.push({ kind: "item", item, key });
    else if (last?.kind === "tools") last.calls.push(item);
    else entries.push({ kind: "tools", calls: [item], key });
  });
  return entries;
}

// An answer can run long (one per question), so it goes under the title instead of squeezing it.
function PermissionLine({ item }: { item: Permission }) {
  return (
    <div className={`flex text-[12px] ${item.answer ? "flex-col gap-1" : "items-start gap-2"}`}>
      <span className="flex min-w-0 flex-1 items-start gap-2">
        <Icon name="lock" size={12} className={`mt-0.5 shrink-0 ${item.decision ? "text-faint" : "text-warn"}`} />
        <span className="min-w-0 flex-1 text-muted">{item.title}</span>
      </span>
      <span className={`${item.answer ? "pl-5" : "shrink-0"} ${item.decision === "allow" ? "text-ok" : item.decision === "deny" ? "text-danger" : "text-warn"}`}>
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
            <MediaView key={src} src={src} alt="Screenshot" thumb={(item.images?.length ?? 0) > 1} />
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

// A message you edited with ↑ and the turn it started, folded to one line you can open.
function EditedFold({ items }: { items: ThreadItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-[11.5px] text-faint">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 hover:text-muted"
      >
        <Icon name={open ? "chevronDown" : "chevronRight"} size={11} />
        Edited · {open ? "hide" : "show"} the version you replaced
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-3 border-l border-line pl-3 opacity-60">
          {groupThread(items).map((entry) =>
            entry.kind === "tools" ? (
              <ToolRun key={entry.key} calls={entry.calls} live={false} />
            ) : (
              <ThreadMessage key={entry.key} item={entry.item} />
            ),
          )}
        </div>
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
    case "result":
      return (
        <div className="flex items-center gap-2 py-1 text-[11px] text-faint">
          <div className="h-px flex-1 bg-line" />
          {item.isError ? (
            <span className="text-danger">{item.text}</span>
          ) : (
            <span>{item.text === "Stopped" ? "Stopped" : "Turn finished"}</span>
          )}
          <div className="h-px flex-1 bg-line" />
        </div>
      );
    case "edited":
      return <EditedFold items={item.items} />;
    case "shell":
      return <ShellLine item={item} />;
  }
});

// A "!" command you ran from the reply box (lib/shell.ts): the command, what it printed, and whether
// Claude has read it yet.
function ShellLine({ item }: { item: Extract<ThreadItem, { kind: "shell" }> }) {
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

// A thread's messages and tool runs, then the reply streaming in. While ↑ edits a message (editFrom is
// its index), that message is outlined and the turn it will replace, everything after it, fades. onSend lets
// a key the thread asked for tell it once the key is in the vault.
export function ThreadEntries({
  entries,
  live,
  streaming,
  editFrom,
  onSend,
}: {
  entries: Entry[];
  live: boolean;
  streaming: string;
  editFrom?: number;
  onSend?: (text: string) => Promise<void>;
}) {
  return (
    <>
      {entries.map((entry) => {
        // One message that fails to draw is a chip in its place; the rest of the thread and the reply box stay.
        const row = (
          <CrashGuard key={entry.key} inline what={entry.kind === "tools" ? "tool run" : "message"} className="self-start">
            {entry.kind === "tools" ? (
              <ToolRun calls={entry.calls} live={live} />
            ) : entry.item.kind === "tool" && entry.item.ask ? (
              <SecretAskInput ask={entry.item.ask} onAdded={onSend} />
            ) : (
              <ThreadMessage item={entry.item} />
            )}
          </CrashGuard>
        );
        // data-turn ties the row to its mini in the glance rail (lib/glance-rail.ts).
        const mark =
          editFrom === undefined || entry.key < editFrom
            ? ""
            : entry.key === editFrom
              ? " outline-1 outline-offset-2 outline-warn outline-dashed"
              : " opacity-40";
        return (
          <div key={entry.key} data-turn={turnId(entry.key)} className={`flex flex-col gap-3 rounded-lg${mark}`}>
            {row}
          </div>
        );
      })}
      {streaming && (
        <div className={editFrom === undefined ? undefined : "opacity-40"}>
          <CrashGuard inline what="reply in progress">
            <Markdown text={streaming} streaming />
          </CrashGuard>
        </div>
      )}
    </>
  );
}
