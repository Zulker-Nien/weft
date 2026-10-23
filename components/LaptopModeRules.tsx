"use client";

// Settings → Laptop mode's rules, under the duration chips: Always while threads run, Only while online,
// and the battery floor. They live in ~/.weft/keep-working.json (electron/keep-working-prefs.cjs).
import ChoiceChip from "./ChoiceChip";
import SwitchRow from "./SwitchRow";

// Mirrors BATTERY_CHOICES in electron/keep-working-prefs.cjs; keep in lockstep if either list changes.
const BATTERY = [5, 10, 20, 30, 50] as const;

export type KwPrefs = { auto?: boolean; minBattery?: number; onlineOnly?: boolean };

export default function LaptopModeRules({
  prefs,
  busy,
  onChange,
}: {
  prefs: KwPrefs;
  busy: boolean;
  onChange: (patch: KwPrefs) => void;
}) {
  const floor = prefs.minBattery ?? 10;
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <SwitchRow
        title="Always while threads run"
        hint="Turns on by itself whenever a thread is running, and off once they all finish. Turn off above pauses it until threads stop."
        on={Boolean(prefs.auto)}
        onChange={(on) => onChange({ auto: on })}
      />
      <SwitchRow
        title="Only while online"
        hint="Sleep comes back once the Mac has been offline for a minute: threads can't run without the network anyway."
        on={Boolean(prefs.onlineOnly)}
        onChange={(on) => onChange({ onlineOnly: on })}
      />
      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[13px] font-medium text-ink">Sleep at low battery</h3>
          <p className="text-[12.5px] text-muted">On battery power, sleep comes back at this charge.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Battery floor">
          {BATTERY.map((pct) => (
            <ChoiceChip key={pct} active={floor === pct} disabled={busy} onClick={() => onChange({ minBattery: pct })}>
              {pct}%
            </ChoiceChip>
          ))}
        </div>
      </section>
    </div>
  );
}
