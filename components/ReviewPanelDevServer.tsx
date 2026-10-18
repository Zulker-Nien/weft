"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { DevServerStatus, ReviewPlan } from "@/lib/types";

const STATE_LABEL: Record<DevServerStatus["state"], string> = {
  stopped: "not running",
  starting: "starting…",
  running: "running",
  failed: "crashed",
};

// Starts the plan's dev server when its url doesn't answer, and keeps checking that it does.
export function ReviewPanelDevServer({ cardId, plan }: { cardId: string; plan: ReviewPlan }) {
  const [status, setStatus] = useState<DevServerStatus>();
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const poll = () =>
      api
        .devStatus(cardId)
        .then((r) => alive && setStatus(r.status))
        // Best-effort 3-second poll; a transient error is picked up on the next tick.
        .catch(() => {});
    api
      .devAction(cardId, "start")
      .then((r) => alive && setStatus(r.status))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)));
    const timer = setInterval(() => void poll(), 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [cardId]);

  // The page opened before the server was up is blank; show it once the server answers.
  const up = status?.reachable;
  useEffect(() => {
    if (up && plan.url) window.weft?.browser.open(plan.url, cardId).catch(() => {});
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