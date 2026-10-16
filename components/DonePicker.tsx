"use client";

import { api } from "@/lib/client";
import type { Effort } from "@/lib/types";
import { useSavedPick } from "./ModelSelect";
import { EffortPicker, ModelPicker } from "./Pickers";

// Settings' "Run /weft:done on …" row: the same model menu as subagents (Claude, Puku, Codex)
// and an effort menu, each starting with the card's own (id ""). A turn-scoped override: the
// Done move snapshots the card's picks and patches them in for the /weft:done turn
// (app/api/cards/[id] moveCard, lib/automations.ts doneOverrides), and lib/runner
// restoreDoneOverride puts the originals back after.
const MODEL_LEADING = [{ value: "", label: "Card's own model" }];
const EFFORT_LEADING = { value: "", label: "Card's own effort" };

export default function DonePicker({ model, effort }: { model: string; effort: Effort | "" }) {
  const [currentModel, pickModel, modelError] = useSavedPick(model, (next) => api.saveSettings({ doneModel: next }));
  const [currentEffort, pickEffort, effortError] = useSavedPick<Effort | "">(effort, (next) =>
    api.saveSettings({ doneEffort: next }),
  );
  return (
    <section className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[13px] font-medium text-ink">Run /weft:done on</h3>
        <p className="text-[12.5px] text-muted">
          {modelError ??
            effortError ??
            "The model and effort the Done wrap-up runs on. A model applies to cards on its own CLI; each card goes back to its own afterwards."}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ModelPicker
          value={currentModel}
          onChange={pickModel}
          label="Model for /weft:done"
          leading={MODEL_LEADING}
        />
        <EffortPicker
          value={currentEffort}
          onChange={pickEffort}
          label="Effort for /weft:done"
          leading={EFFORT_LEADING}
        />
      </div>
    </section>
  );
}