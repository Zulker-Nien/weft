// The Accounts page: the Weft account, the CLI sign-ins.
import { SETTINGS_HINT, SETTINGS_TITLE } from "@/lib/settings-shared";
import AccountSettings from "./AccountSettings";
import CliLogins from "./CliLogins";
import { SettingsCard } from "./SettingsLayout";

export default function SettingsAccountsPage() {
  return (
    <>
      <SettingsCard>
        <AccountSettings titleClass={SETTINGS_TITLE} hintClass={SETTINGS_HINT} />
      </SettingsCard>
      <SettingsCard>
        <CliLogins titleClass={SETTINGS_TITLE} />
      </SettingsCard>
    </>
  );
}
