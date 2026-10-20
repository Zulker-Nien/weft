"use client";

import { api } from "@/lib/client";
import { useSavedPick } from "./ModelSelect";
import { ModelPicker } from "./Pickers";

// Settings → Models → "Backup model" row: the model the first-message-failed banner reruns
// the card on (lib/backend-switch.ts rerunOnModel). Differs from DonePicker in that the
// "Off" leading option disables the banner entirely (the button reads "Pick a backup
// model" instead). No effort picker: the rerun keeps the card's own effort.
const LEADING = [{ value: "", label: "Off — no backup" }];

export default function BackupModelPicker({ value }: { value: string }) {
  const [current, pick, error] = useSavedPick(value, (next) => api.saveSettings({ backupModel: next }));
  return (
    <section className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[13px] font-medium text-ink">Backup model</h3>
        <p className="text-[12.5px] text-muted">
          {error ??
            "When the first message of a card comes back an error, a banner lets you rerun it on this model instead of the card's own. Pick \u2018Off\u2019 to hide the rerun button."}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ModelPicker
          value={current}
          onChange={pick}
          label="Backup model"
          leading={LEADING}
        />
      </div>
    </section>
  );
}
