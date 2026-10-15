"use client";

import { useState } from "react";
import { BACKENDS, EFFORTS, MODELS, lastEffort, modelFor, setLastEffort, setModelFor } from "@/lib/new-thread";
import type { Backend, Effort } from "@/lib/types";
import { SELECT_CLASS } from "./ModelSelect";

// Settings → Models → New threads: the CLI, model and effort a new thread starts on. The CLI waits for Save
// (it's a server setting the API and copilot use too); the model and effort are the New thread dialog's own
// remembered picks, so they change right away, and picking something else in that dialog moves them again.
export default function NewThreadDefaults({
  backend,
  onBackend,
}: {
  backend: Backend;
  onBackend: (backend: Backend) => void;
}) {
  const [models, setModels] = useState<Record<Backend, string>>(() => ({
    claude: modelFor("claude"),
    puku: modelFor("puku"),
    codex: modelFor("codex"),
  }));
  const [effort, setEffort] = useState<Effort | "">(lastEffort);

  return (
    <section className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[13px] font-medium text-ink">New threads</h3>
        <p className="text-[12.5px] text-muted">
          What a new thread starts on. The New thread dialog remembers what you pick there, too.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <select
          value={backend}
          aria-label="Default CLI"
          onChange={(e) => onBackend(e.target.value as Backend)}
          className={SELECT_CLASS}
        >
          {BACKENDS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <select
          value={models[backend]}
          aria-label="Default model"
          onChange={(e) => {
            setModelFor(backend, e.target.value);
            setModels((m) => ({ ...m, [backend]: e.target.value }));
          }}
          className={SELECT_CLASS}
        >
          {MODELS[backend].map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          value={effort}
          aria-label="Default effort"
          onChange={(e) => {
            const next = e.target.value as Effort | "";
            setLastEffort(next);
            setEffort(next);
          }}
          className={SELECT_CLASS}
        >
          {EFFORTS.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
