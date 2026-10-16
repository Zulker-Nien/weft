// The Automations page: the list of automation rules and the "push on Done" setting.
import type { Automation } from "@/lib/types";
import AutomationSettings from "./AutomationSettings";
import { SettingsCard } from "./SettingsLayout";

export default function SettingsAutomationsPage({
  rules,
  setRules,
  pushOnDone,
  clearSaveError,
}: {
  rules: Automation[];
  setRules: (next: Automation[]) => void;
  pushOnDone: boolean;
  clearSaveError: () => void;
}) {
  return (
    <SettingsCard>
      <AutomationSettings
        rules={rules}
        pushOnDone={pushOnDone}
        onChange={(next) => {
          setRules(next);
          clearSaveError();
        }}
      />
    </SettingsCard>
  );
}
