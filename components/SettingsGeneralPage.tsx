// The General page: appearance, the Backlog and Progress toggles, your Claude Code history, the folders
// threads may read without asking, and sound settings.
import { setShowBacklog, setShowProgress } from "@/lib/board-prefs";
import { SETTINGS_HINT, SETTINGS_TITLE } from "@/lib/settings-shared";
import AppearancePicker from "./AppearancePicker";
import HistorySettings from "./HistorySettings";
import { SettingsCard, SettingsSectionHeader } from "./SettingsLayout";
import SoundSettings from "./SoundSettings";
import SwitchRow from "./SwitchRow";
import TrustedFolders from "./TrustedFolders";

export default function SettingsGeneralPage({
  backlog,
  setBacklog,
  progress,
  setProgress,
  allowedFolders = [],
}: {
  backlog: boolean;
  setBacklog: (on: boolean) => void;
  progress: boolean;
  setProgress: (on: boolean) => void;
  // From the settings view the dialog already loaded. General is one of the pages that draws before that
  // lands (only the three that need settings wait), so this defaults to empty rather than holding the page.
  allowedFolders?: string[];
}) {
  return (
    <>
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
        <HistorySettings />
      </SettingsCard>
      <SettingsCard>
        <TrustedFolders folders={allowedFolders} />
      </SettingsCard>
      <SettingsCard>
        <SoundSettings titleClass={SETTINGS_TITLE} hintClass={SETTINGS_HINT} />
      </SettingsCard>
    </>
  );
}
