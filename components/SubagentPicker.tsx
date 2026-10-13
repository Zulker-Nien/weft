"use client";

import { api } from "@/lib/client";
import type { SubagentModel } from "@/lib/subagents";
import ModelSelect, { useSavedPick } from "./ModelSelect";

const LEADING = [
  { value: "choose", label: "Let the model choose" },
  { value: "inherit", label: "Same model as the thread" },
];

// Settings' "Use … for subagents" row. It saves as soon as it changes; new and idle threads pick it up on
// their next message (lib/runner-session.ts).
export default function SubagentPicker({ value }: { value: SubagentModel }) {
  const [model, pick, error] = useSavedPick(value, (next) => api.saveSettings({ subagentModel: next }));
  return (
    <section className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[13px] font-medium text-ink">Use for subagents</h3>
        <p className="text-[12.5px] text-muted">
          {error ?? "Letting the model choose picks per task. The other CLI's models run it headless as the subagent."}
        </p>
      </div>
      <ModelSelect value={model} label="Use for subagents" leading={LEADING} onChange={pick} />
    </section>
  );
}
