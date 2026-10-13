"use client";

import { useState } from "react";
import { MODELS } from "@/lib/new-thread";

// Settings' model menus (SubagentPicker, DonePicker): a few leading choices, then every model either CLI
// serves under a Claude and a Puku heading, so a model added to MODELS shows up in each of them.
const GROUPS = [
  { label: "Claude", models: MODELS.claude },
  { label: "Puku", models: MODELS.puku },
];

export const SELECT_CLASS =
  "rounded-md border border-line-strong bg-canvas px-2.5 py-[7px] text-[12.5px] text-ink outline-none focus:border-accent";

export default function ModelSelect({
  value,
  label,
  leading,
  onChange,
}: {
  value: string;
  label: string;
  leading: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} className={SELECT_CLASS}>
      {leading.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {GROUPS.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// A Settings value that saves as soon as it changes, and goes back with the reason if the save fails.
export function useSavedPick<T>(initial: T, save: (value: T) => Promise<unknown>) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  function pick(next: T) {
    const before = value;
    setValue(next);
    setError(null);
    save(next).catch((err: unknown) => {
      setValue(before);
      setError(`Couldn’t save: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
  return [value, pick, error] as const;
}
