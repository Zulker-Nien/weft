// The Settings screen's two levels: sections down the left, each with its tabs along the top.

export type SettingsTab =
  | "appearance"
  | "board"
  | "sounds"
  | "shortcuts"
  | "defaults"
  | "instructions"
  | "subagents"
  | "rules"
  | "done"
  | "account"
  | "clis";

export type SettingsSection = "general" | "threads" | "automations" | "accounts";

type Tab = { id: SettingsTab; label: string };
export type SettingsNavSection = { id: SettingsSection; label: string; tabs: [Tab, ...Tab[]] };

export const SETTINGS_NAV: SettingsNavSection[] = [
  {
    id: "general",
    label: "General",
    tabs: [
      { id: "appearance", label: "Appearance" },
      { id: "board", label: "Board" },
      { id: "sounds", label: "Sounds" },
      { id: "shortcuts", label: "Shortcuts" },
    ],
  },
  {
    id: "threads",
    label: "Threads",
    tabs: [
      { id: "defaults", label: "Defaults" },
      { id: "instructions", label: "Instructions" },
      { id: "subagents", label: "Subagents" },
    ],
  },
  {
    id: "automations",
    label: "Automations",
    tabs: [
      { id: "rules", label: "Rules" },
      { id: "done", label: "Done wrap-up" },
    ],
  },
  {
    id: "accounts",
    label: "Accounts",
    tabs: [
      { id: "account", label: "Weft account" },
      { id: "clis", label: "CLIs" },
    ],
  },
];

const TAB_SECTION: Record<SettingsTab, SettingsSection> = {
  appearance: "general",
  board: "general",
  sounds: "general",
  shortcuts: "general",
  defaults: "threads",
  instructions: "threads",
  subagents: "threads",
  rules: "automations",
  done: "automations",
  account: "accounts",
  clis: "accounts",
};

const BY_ID = Object.fromEntries(SETTINGS_NAV.map((s) => [s.id, s])) as Record<SettingsSection, SettingsNavSection>;

export function sectionOf(tab: SettingsTab): SettingsSection {
  return TAB_SECTION[tab];
}

export function navSectionOf(tab: SettingsTab): SettingsNavSection {
  return BY_ID[TAB_SECTION[tab]];
}

// Picking a section opens its first tab, or the one last open in it.
export function firstTab(section: SettingsSection, remembered: Partial<Record<SettingsSection, SettingsTab>> = {}) {
  return remembered[section] ?? BY_ID[section].tabs[0].id;
}

// The settings that wait for Save, by the tab they sit on, so the nav can mark unsaved edits.
export type PendingEdits = {
  prompt: boolean;
  keepAlive: boolean;
  mode: boolean;
  backend: boolean;
  rules: boolean;
};

export function unsavedTabs(p: PendingEdits): Set<SettingsTab> {
  const tabs = new Set<SettingsTab>();
  if (p.keepAlive || p.mode || p.backend) tabs.add("defaults");
  if (p.prompt) tabs.add("instructions");
  if (p.rules) tabs.add("rules");
  return tabs;
}

export function unsavedSections(tabs: Set<SettingsTab>): Set<SettingsSection> {
  return new Set([...tabs].map(sectionOf));
}

// The tab the screen opens on: the last one you had open this session.
let lastTab: SettingsTab = "appearance";
export const rememberedTab = () => lastTab;
export function rememberTab(tab: SettingsTab) {
  lastTab = tab;
}
