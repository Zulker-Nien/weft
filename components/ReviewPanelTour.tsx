"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { stepUrl } from "@/lib/review";
import { moveDraft, readDraft, replyDraftKey, writeDraft } from "@/lib/drafts";
import { lastLocalUrl } from "@/lib/review-tour";
import type { ReviewPlan, ThreadItem } from "@/lib/types";
import Composer, { type ComposerHandle } from "./Composer";
import Icon from "./Icon";
import { ReviewPanelDevServer } from "./ReviewPanelDevServer";
import { ReviewPanelLookFor } from "./ReviewPanelLookFor";

// What you were typing as feedback on a step, kept until it's sent.
const feedbackKey = (cardId: string, step: number) => `weft.review.${cardId}.${step}`;

// The tour a thread left for its Review card: one step at a time, with what to look for, the page
// opened in the browser pane when it's a web product, and a box to send feedback on that step.
export function ReviewPanelTour({
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
  // A tour that left out its url still has an app to show: the one the thread talked about. Not when every
  // step names its own page (an HTML file, a full URL): the thread prompt leaves url out when there's no app.
  const needsApp = !written.url && written.steps.some((s) => !stepUrl(written, s));
  const guess = needsApp ? lastLocalUrl(items) : undefined;
  const plan = useMemo(() => (guess ? { ...written, url: guess } : written), [written, guess]);
  const [index, setIndex] = useState(0);
  const [approved, setApproved] = useState<Set<number>>(new Set());
  const composer = useRef<ComposerHandle>(null);
  const [empty, setEmpty] = useState(() => !readDraft(feedbackKey(cardId, 0)).trim());
  // The step the box belongs to, so a change saves under it even while go() is switching steps.
  const boxStep = useRef(0);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const steps = plan.steps;
  const step = steps[Math.min(index, steps.length - 1)];
  const url = step ? stepUrl(plan, step) : undefined;

  // The tour takes the reply box's place when the card lands in Review, maybe mid-sentence: bring what you
  // were typing along into this step's box, focused at its end, so you keep typing. An effect, so it runs
  // after the reply box's unmount has written its last keystrokes.
  useEffect(() => {
    const moved = moveDraft(replyDraftKey(cardId), feedbackKey(cardId, boxStep.current));
    if (!moved) return;
    composer.current?.write(moved);
    setEmpty(false);
  }, [cardId]);

  // Show each step's page as you reach it.
  useEffect(() => {
    if (url) window.threadboard?.browser.open(url, cardId).catch(() => {});
  }, [url, cardId]);

  const last = index >= steps.length - 1;

  function go(to: number) {
    const next = Math.max(0, Math.min(steps.length - 1, to));
    setIndex(next);
    boxStep.current = next;
    const draft = readDraft(feedbackKey(cardId, next));
    if (draft) composer.current?.write(draft);
    else composer.current?.clear();
    setEmpty(!draft.trim());
    setError("");
  }

  // The feedback box is the same composer as the reply box: screenshots paste or drop right in.
  async function sendFeedback() {
    const box = composer.current;
    if (sending || !step || !box || box.isEmpty()) return;
    let text: string;
    try {
      text = box.read();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!text) return;
    setSending(true);
    try {
      await onSend(`Review feedback on step ${index + 1} of ${steps.length}, “${step.title}”:\n${text}`);
      composer.current?.clear();
      writeDraft(feedbackKey(cardId, boxStep.current), "");
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

  // A tour always has a step (lib/review.ts drops one without any).
  if (!step) return null;

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
          {plan.dev && plan.url && <ReviewPanelDevServer cardId={cardId} plan={plan} />}
          {step.look && <ReviewPanelLookFor key={index} text={step.look} />}
          <div className="mt-2">
            <Composer
              ref={composer}
              variant="reply"
              cwd={cwd}
              // It stands in for the reply box, so files dropped on this card or thread land here.
              dropTarget={cardId}
              initial={readDraft(feedbackKey(cardId, index))}
              placeholder="Anything wrong or missing here? Paste a screenshot to show it. (Enter to send)"
              onSubmit={() => void sendFeedback()}
              onChange={(markdown) => {
                writeDraft(feedbackKey(cardId, boxStep.current), markdown);
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