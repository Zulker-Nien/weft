// The Shortcuts page: the rebindable keyboard shortcut list.
import { SETTINGS_HINT, SETTINGS_TITLE } from "@/lib/settings-shared";
import { SettingsCard } from "./SettingsLayout";
import ShortcutSettings from "./ShortcutSettings";

export default function SettingsShortcutsPage() {
  return (
    <SettingsCard>
      <ShortcutSettings titleClass={SETTINGS_TITLE} hintClass={SETTINGS_HINT} />
    </SettingsCard>
  );
}
