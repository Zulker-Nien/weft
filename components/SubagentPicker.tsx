"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { SUBAGENT_MODEL_LABELS, SUBAGENT_MODELS, type SubagentModel } from "@/lib/subagents";

// Settings' "Use … for subagents" row. Like push on Done, it saves as soon as it changes (and goes back
// if that fails); new and idle threads pick it up on their next message (lib/runner-session.ts).
export default function SubagentPicker({ value }: { value: SubagentModel }) {
  const [model, setModel] = useState(value);
  const [error, setError] = useState<string | null>(null);

  function pick(next: SubagentModel) {
    const before = model;
    setModel(next);
    setError(null);
    api.saveSettings({ subagentModel: next }).catch((err: unknown) => {
      setModel(before);
      setError(`Couldn’t save: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  return (
    <section className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[13px] font-medium text-ink">Use for subagents</h3>
        <p className="text-[12.5px] text-muted">
          {error ?? "Letting the model choose picks per task: Haiku for searches, Sonnet for most coding, Opus for hard reasoning."}
        </p>
      </div>
      <select
        value={model}
        aria-label="Use for subagents"
        onChange={(e) => pick(e.target.value as SubagentModel)}
        className="rounded-md border border-line-strong bg-canvas px-2.5 py-[7px] text-[12.5px] text-ink outline-none focus:border-accent"
      >
        {SUBAGENT_MODELS.map((m) => (
          <option key={m} value={m}>
            {SUBAGENT_MODEL_LABELS[m]}
          </option>
        ))}
      </select>
    </section>
  );
}
