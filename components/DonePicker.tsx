"use client";

import { api } from "@/lib/client";
import { EFFORTS } from "@/lib/new-thread";
import type { Effort } from "@/lib/types";
import ModelSelect, { SELECT_CLASS, useSavedPick } from "./ModelSelect";

// Settings' "Run /weft:done on …" row: the same model menu as subagents (Claude and Puku headings) and an
// effort menu, each starting with the card's own (id ""). A turn-scoped override: the Done move
// snapshots the card's picks and patches them in for the /weft:done turn (app/api/cards/[id] moveCard,
// lib/automations.ts doneOverrides), and lib/runner restoreDoneOverride puts the originals back after.
const LEADING = [{ value: "", label: "Card's own model" }];

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
        <ModelSelect value={currentModel} label="Model for /weft:done" leading={LEADING} onChange={pickModel} />
        <select
          value={currentEffort}
          aria-label="Effort for /weft:done"
          onChange={(e) => pickEffort(e.target.value as Effort | "")}
          className={SELECT_CLASS}
        >
          {EFFORTS.map((e) => (
            <option key={e.id} value={e.id}>
              {e.id === "" ? "Card's own effort" : e.label}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
