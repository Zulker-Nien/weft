// The General page: laptop mode, appearance, the Backlog and Progress toggles, and sound settings.
import { setShowBacklog, setShowProgress } from "@/lib/board-prefs";
import { SETTINGS_HINT, SETTINGS_TITLE } from "@/lib/settings-shared";
import AppearancePicker from "./AppearancePicker";
import LaptopModeCard from "./LaptopModeCard";
import { SettingsCard, SettingsSectionHeader } from "./SettingsLayout";
import SoundSettings from "./SoundSettings";
import SwitchRow from "./SwitchRow";

export default function SettingsGeneralPage({
  backlog,
  setBacklog,
  progress,
  setProgress,
}: {
  backlog: boolean;
  setBacklog: (on: boolean) => void;
  progress: boolean;
  setProgress: (on: boolean) => void;
}) {
  return (
    <>
      <SettingsCard>
        <LaptopModeCard />
      </SettingsCard>
      <SettingsCard>
        <section className="flex flex-col gap-3">
          <SettingsSectionHeader
            title="Appearance"
            hint="Changes right away. System follows your computer&apos;s setting; a scene puts its picture behind the board."
          />
          <AppearancePicker />
        </section>
      </SettingsCard>
      <SettingsCard>
        <SwitchRow
          title="Show backlog"
          hint="A column for threads you add without starting. It still shows while cards wait in it."
          on={backlog}
          onChange={(on) => {
            setShowBacklog(on);
            setBacklog(on);
          }}
        />
        <SwitchRow
          title="Show progress"
          hint="Your streak and level in the header, with badges and level-ups as toasts. Off is quiet mode."
          on={progress}
          onChange={(on) => {
            setShowProgress(on);
            setProgress(on);
          }}
        />
      </SettingsCard>
      <SettingsCard>
        <SoundSettings titleClass={SETTINGS_TITLE} hintClass={SETTINGS_HINT} />
      </SettingsCard>
    </>
  );
}
