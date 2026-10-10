"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { stepUrl } from "@/lib/review";
import { api } from "@/lib/client";
import type { Card, DevServerStatus, ReviewPlan, ThreadItem } from "@/lib/types";
import Composer, { type ComposerHandle } from "./Composer";
import Icon from "./Icon";

// The tour a thread left for its Review card: one step at a time, with what to look for, the page
// opened in the browser pane when it's a web product, and a box to send feedback on that step.
export default function ReviewPanel({
  card,
  items,
  onSend,
}: {
  card: Card;
  items: ThreadItem[];
  onSend: (text: string) => Promise<void>;
}) {
  // A new plan (the thread answered feedback) starts the tour over.
  return card.review ? (
    <Tour key={JSON.stringify(card.review)} cardId={card.id} cwd={card.cwd} plan={card.review} items={items} onSend={onSend} />
  ) : (
    <NoTour cardId={card.id} items={items} onSend={onSend} />
  );
}

const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1):\d+/g;

// The local app the thread talked about most (its dev server), as the address of its home page.
// The newest mention is a worse guess: threads end on API calls and throwaway test servers.
function lastLocalUrl(items: ThreadItem[]): string | undefined {
  const counts = new Map<string, number>();
  for (const item of items) {
    const text = item.kind === "assistant" ? item.text : item.kind === "tool" ? `${item.summary} ${item.result ?? ""}` : "";
    for (const origin of text.match(LOCAL_URL) ?? []) counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  // Weft's own address isn't the card's app, even when the card is working on Weft.
  const self = typeof window === "undefined" ? "" : window.location.origin.replace("localhost", "127.0.0.1");
  let best: string | undefined;
  for (const [origin, n] of counts) {
    if (origin.replace("localhost", "127.0.0.1") === self) continue;
    if (!best || n >= (counts.get(best) ?? 0)) best = origin;
  }
  return best && `${best}/`;
}

// A Review card whose thread wrote no tour (it predates them): still show its app, and offer to ask for one.
function NoTour({ cardId, items, onSend }: { cardId: string; items: ThreadItem[]; onSend: (text: string) => Promise<void> }) {
  const url = lastLocalUrl(items);
  useEffect(() => {
    if (url) window.threadboard?.browser.open(url, cardId).catch(() => {});
  }, [url, cardId]);

  return (
    <section className="flex items-center gap-2 border-t border-line bg-accent-soft/40 px-4 py-2 text-[12px]">
      <span className="min-w-0 flex-1 text-muted">No review tour yet{url ? ` · showing ${url}` : ""}</span>
      <button
        onClick={() =>
          void onSend(
            "Write a review tour for what you built: end your reply with a weft-review block (one step per feature, what to look for, and the page), then the BOARD STATUS line.",
          )
        }
        className="shrink-0 rounded-md border border-line-strong px-2.5 py-1 text-[12px] text-ink hover:bg-sunken"
      >
        Build review tour
      </button>
    </section>
  );
}

const STATE_LABEL: Record<DevServerStatus["state"], string> = {
  stopped: "not running",
  starting: "starting…",
  running: "running",
  failed: "crashed",
};

// Starts the plan's dev server when its url doesn't answer, and keeps checking that it does.
function DevServer({ cardId, plan }: { cardId: string; plan: ReviewPlan }) {
  const [status, setStatus] = useState<DevServerStatus>();
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const poll = () =>
      api
        .devStatus(cardId)
        .then((r) => alive && setStatus(r.status))
        .catch(() => {});
    api
      .devAction(cardId, "start")
      .then((r) => alive && setStatus(r.status))
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    const timer = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [cardId]);

  // The page opened before the server was up is blank; show it once the server answers.
  const up = status?.reachable;
  useEffect(() => {
    if (up && plan.url) window.threadboard?.browser.open(plan.url, cardId).catch(() => {});
  }, [up, plan.url, cardId]);

  async function act(action: "start" | "restart" | "stop") {
    setError("");
    try {
      setStatus((await api.devAction(cardId, action)).status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const state = status?.reachable ? "running" : (status?.state ?? "starting");
  const dot = state === "running" ? "bg-ok" : state === "failed" ? "bg-danger" : "bg-muted";
  return (
    <div className="mb-2 flex items-center gap-2 text-[12px]">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0 flex-1 truncate text-muted" title={status?.log || plan.dev}>
        {plan.url} · {STATE_LABEL[state]}
        {error && <span className="text-danger"> · {error}</span>}
      </span>
      <button
        onClick={() => void act(state === "running" || state === "starting" ? "restart" : "start")}
        className="shrink-0 rounded-md border border-line-strong px-2 py-0.5 text-[11.5px] text-ink hover:bg-sunken"
      >
        {state === "running" || state === "starting" ? "Restart" : "Start"} server
      </button>
    </div>
  );
}

function Tour({
  cardId,
  cwd,
  plan: written,
  items,
  onSend,
}: {
  cardId: string;
  cwd: string;
  plan: ReviewPlan;
  items: ThreadItem[];
  onSend: (text: string) => Promise<void>;
}) {
  // A tour that left out its url still has an app to show: the one the thread talked about.
  const guess = written.url ? undefined : lastLocalUrl(items);
  const plan = useMemo(() => (guess ? { ...written, url: guess } : written), [written, guess]);
  const [index, setIndex] = useState(0);
  const [approved, setApproved] = useState<Set<number>>(new Set());
  const composer = useRef<ComposerHandle>(null);
  const [empty, setEmpty] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const steps = plan.steps;
  const step = steps[Math.min(index, steps.length - 1)];
  const url = stepUrl(plan, step);

  // Show each step's page as you reach it.
  useEffect(() => {
    if (url) window.threadboard?.browser.open(url, cardId).catch(() => {});
  }, [url, cardId]);

  const last = index >= steps.length - 1;

  function go(to: number) {
    setIndex(Math.max(0, Math.min(steps.length - 1, to)));
    composer.current?.clear();
    setEmpty(true);
    setError("");
  }

  // The feedback box is the same composer as the reply box: screenshots paste or drop right in.
  async function sendFeedback() {
    if (sending || !composer.current || composer.current.isEmpty()) return;
    let text: string;
    try {
      text = composer.current.read();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!text) return;
    setSending(true);
    try {
      await onSend(`Review feedback on step ${index + 1} of ${steps.length}, “${step.title}”:\n${text}`);
      composer.current?.clear();
      setEmpty(true);
      setError("");
    } finally {
      setSending(false);
    }
  }

  // The last step's button wraps the thread up with Weft's done skill, as the Skills menu would.
  function approve() {
    setApproved((prev) => new Set(prev).add(index));
    if (!last) go(index + 1);
    else void onSend("/weft:done");
  }

  return (
    <section className="border-t border-line bg-accent-soft/40">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-[12px] font-medium text-ink"
      >
        <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={12} />
        Review
        <span className="font-normal text-muted">
          step {Math.min(index + 1, steps.length)} of {steps.length} · {approved.size} approved
        </span>
      </button>
      {!collapsed && (
        <div className="px-4 pb-3">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug text-ink">
              {approved.has(index) && <Icon name="check" size={13} className="mr-1 inline text-ok" />}
              {step.title}
            </h3>
            <button
              onClick={() => void (url ? window.threadboard?.browser.open(url, cardId) : window.threadboard?.browser.setVisible(true))}
              title={url ?? "Show the browser pane"}
              className="flex shrink-0 items-center gap-1 rounded-md border border-line-strong px-2 py-0.5 text-[11.5px] text-ink hover:bg-sunken"
            >
              <Icon name="globe" size={11} /> Open browser
            </button>
          </div>
          {plan.dev && plan.url && <DevServer cardId={cardId} plan={plan} />}
          {step.look && (
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              <span className="font-medium text-ink">Look for: </span>
              {step.look}
            </p>
          )}
          <div className="mt-2">
            <Composer
              ref={composer}
              variant="reply"
              cwd={cwd}
              placeholder="Anything wrong or missing here? Paste a screenshot to show it. (Enter to send)"
              onSubmit={() => void sendFeedback()}
              onChange={(markdown) => {
                setEmpty(!markdown.trim());
                setError("");
              }}
              sizeClass="min-h-[44px] max-h-[30vh]"
            />
            {error && <p className="mt-1 text-[11.5px] text-danger">{error}</p>}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => go(index - 1)}
              disabled={index === 0}
              aria-label="Previous step"
              className="rounded-md border border-line-strong p-1.5 text-ink hover:bg-sunken disabled:opacity-40"
            >
              <Icon name="chevronLeft" size={13} />
            </button>
            <button
              onClick={() => void sendFeedback()}
              disabled={empty || sending}
              className="rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-40"
            >
              Send feedback
            </button>
            <span className="flex-1" />
            <button
              onClick={approve}
              className="rounded-md bg-accent px-3 py-1 text-[12.5px] font-medium text-on-accent hover:opacity-90"
            >
              {last ? "Done" : "Looks good, next"}
            </button>
            <button
              onClick={() => go(index + 1)}
              disabled={last}
              aria-label="Next step"
              className="rounded-md border border-line-strong p-1.5 text-ink hover:bg-sunken disabled:opacity-40"
            >
              <Icon name="chevronRight" size={13} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
