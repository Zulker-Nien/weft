// The Models page: the new-thread defaults (CLI, model, effort), and the subagent / copilot /
// review-all / done / backup pickers.
import type { Backend, Effort } from "@/lib/types";
import BackupModelPicker from "./BackupModelPicker";
import CopilotPicker from "./CopilotPicker";
import DonePicker from "./DonePicker";
import NewThreadDefaults from "./NewThreadDefaults";
import ReviewAllPicker from "./ReviewAllPicker";
import { SettingsCard } from "./SettingsLayout";
import SubagentPicker from "./SubagentPicker";

export default function SettingsModelsPage({
  settings: s,
  defaultBackend,
  setDefaultBackend,
  clearSaveError,
}: {
  settings: { subagentModel: string; copilotModel: string; reviewAllModel: string; doneModel: string; doneEffort: Effort | ""; backupModel: string };
  defaultBackend: Backend;
  setDefaultBackend: (next: Backend) => void;
  clearSaveError: () => void;
}) {
  return (
    <SettingsCard>
      <NewThreadDefaults
        backend={defaultBackend}
        onBackend={(next) => {
          setDefaultBackend(next);
          clearSaveError();
        }}
      />
      <SubagentPicker value={s.subagentModel} />
      <CopilotPicker value={s.copilotModel} />
      <ReviewAllPicker value={s.reviewAllModel} />
      <DonePicker model={s.doneModel} effort={s.doneEffort} />
      <BackupModelPicker value={s.backupModel} />
    </SettingsCard>
  );
}