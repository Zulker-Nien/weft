import { SCENES, sceneOf, type Base, type Scene } from "./theme";

// The Settings screen's pages, down the left. Each is one scrolling page of cards; no tabs.
export type SettingsPage = "general" | "models" | "threads" | "automations" | "shortcuts" | "accounts" | "team";

export const SETTINGS_PAGES: { id: SettingsPage; label: string; hint: string }[] = [
  { id: "general", label: "General", hint: "How the board looks and sounds." },
  { id: "models", label: "Models", hint: "Which CLI and model each kind of work runs on." },
  { id: "threads", label: "Threads", hint: "How new threads start and what they're told." },
  { id: "automations", label: "Automations", hint: "Skills that run on their own." },
  { id: "shortcuts", label: "Shortcuts", hint: "Keys for the board's global actions." },
  { id: "accounts", label: "Accounts", hint: "Your Weft account and the CLIs' logins." },
  { id: "team", label: "Team", hint: "Your Weft workspace and the people in it." },
];

const BY_ID = Object.fromEntries(SETTINGS_PAGES.map((p) => [p.id, p])) as Record<SettingsPage, (typeof SETTINGS_PAGES)[number]>;
export const pageInfo = (id: SettingsPage) => BY_ID[id];

// The settings that wait for Save, so the nav can mark the pages they sit on.
export type PendingEdits = {
  prompt: boolean;
  keepAlive: boolean;
  mode: boolean;
  backend: boolean;
  rules: boolean;
};

export function unsavedPages(p: PendingEdits): Set<SettingsPage> {
  const pages = new Set<SettingsPage>();
  if (p.backend) pages.add("models");
  if (p.prompt || p.keepAlive || p.mode) pages.add("threads");
  if (p.rules) pages.add("automations");
  return pages;
}

// Twin Suns over the dark palette, Salt Flats over the light one.
const FALLBACK_SCENE: Record<Base, Scene> = { dark: SCENES[0], light: SCENES[5] };

// The picture behind Settings: your scene if you've picked one, else one that suits the light or dark palette.
export function settingsScene(theme: string, base: Base): Scene {
  return sceneOf(theme) ?? FALLBACK_SCENE[base];
}

// The page the screen opens on: the last one you had open this session.
let lastPage: SettingsPage = "general";
export const rememberedPage = () => lastPage;
export function rememberPage(page: SettingsPage) {
  lastPage = page;
}
