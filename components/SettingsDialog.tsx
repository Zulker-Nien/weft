"use client";

import { useEffect, useState, type ReactNode } from "react";
import { setShowBacklog, setShowProgress, showBacklog, showProgress } from "@/lib/board-prefs";
import { api } from "@/lib/client";
import {
  SETTINGS_PAGES,
  pageInfo,
  rememberPage,
  rememberedPage,
  settingsScene,
  unsavedPages,
  type SettingsPage,
} from "@/lib/settings-nav";
import { sceneUrl, type Base, type Scene } from "@/lib/theme";
import type { Automation, Backend, PermissionMode, SettingsView } from "@/lib/types";
import AccountSettings from "./AccountSettings";
import AppearancePicker from "./AppearancePicker";
import AutomationSettings from "./AutomationSettings";
import CliLogins from "./CliLogins";
import DonePicker from "./DonePicker";
import Icon, { Spinner } from "./Icon";
import LaptopModeCard from "./LaptopModeCard";
import TeamSettings from "./TeamSettings";
import Modal from "./Modal";
import { SELECT_CLASS } from "./ModelSelect";
import ModePicker from "./ModePicker";
import NewThreadDefaults from "./NewThreadDefaults";
import ShortcutSettings from "./ShortcutSettings";
import SoundSettings from "./SoundSettings";
import SubagentPicker from "./SubagentPicker";
import SwitchRow from "./SwitchRow";

const KEEP_ALIVE: { minutes: number; label: string }[] = [
  { minutes: 0, label: "Until the app quits" },
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 15, label: "15 minutes" },
];

// The pages whose settings come from the server; the rest draw right away.
const NEEDS_SETTINGS = new Set<SettingsPage>(["models", "threads", "automations"]);

// A dark wash over a dark scene, a light one over a light scene, so the header and frosted cards read.
const SCRIM: Record<Base, string> = {
  dark: "linear-gradient(180deg, rgb(0 0 0 / 0.45), rgb(0 0 0 / 0.15) 35%, rgb(0 0 0 / 0.5))",
  light: "linear-gradient(180deg, rgb(255 255 255 / 0.55), rgb(255 255 255 / 0.2) 35%, rgb(255 255 255 / 0.55))",
};

const TITLE = "text-[13px] font-medium text-ink";
const HINT = "text-[12.5px] text-muted";

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function currentScene(): Scene {
  const root = document.documentElement;
  return settingsScene(root.dataset.scene ?? "", root.dataset.theme === "dark" ? "dark" : "light");
}

// The board's scene, following a pick in Appearance while Settings is open.
function useScene(): Scene {
  const [scene, setScene] = useState(currentScene);
  useEffect(() => {
    const watch = new MutationObserver(() => setScene(currentScene()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scene", "data-theme"] });
    return () => watch.disconnect();
  }, []);
  return scene;
}

// A setting's title and hint, stacked on the left of its row.
function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className={TITLE}>{title}</h3>
      <p className={HINT}>{hint}</p>
    </div>
  );
}

// A frosted card over the scene, holding one group of settings. The card stops mousedown so
// clicks on it (and its solid background) don't close the dialog as if they were the scene.
function Card({ children }: { children: ReactNode }) {
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      className="flex flex-col gap-5 rounded-xl border border-line-strong bg-panel/85 p-5 shadow-lg backdrop-blur-xl"
    >
      {children}
    </div>
  );
}

// The small accent dot on a page whose edits wait for Save.
function UnsavedDot() {
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="Unsaved changes" />;
}

// Settings fills the window over one of Weft's scenes: pages down the left, the open page's cards on the right.
// Appearance, board, sound, shortcut, account and most model changes apply right away; the rest wait for Save.
export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [keepAlive, setKeepAlive] = useState(0);
  const [mode, setMode] = useState<PermissionMode>("auto");
  const [defaultBackend, setDefaultBackend] = useState<Backend>("claude");
  const [rules, setRules] = useState<Automation[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [backlog, setBacklog] = useState(showBacklog);
  const [progress, setProgress] = useState(showProgress);
  const [page, setPageState] = useState<SettingsPage>(rememberedPage);
  const scene = useScene();

  function setPage(next: SettingsPage) {
    rememberPage(next);
    setPageState(next);
  }

  useEffect(() => {
    let ignore = false;
    api.settings().then(
      (s) => {
        if (ignore) return;
        setSettings(s);
        setPrompt(s.threadPrompt);
        setKeepAlive(s.keepAliveMinutes);
        setMode(s.defaultPermissionMode);
        setDefaultBackend(s.defaultBackend);
        setRules(s.automations);
      },
      (err: unknown) => {
        if (!ignore) setLoadError(message(err));
      },
    );
    return () => {
      ignore = true;
    };
  }, []);

  const isDefaultPrompt = settings !== null && prompt.trim() === settings.defaultThreadPrompt.trim();
  const promptChanged = settings !== null && prompt.trim() !== settings.threadPrompt.trim();
  const keepAliveChanged = settings !== null && keepAlive !== settings.keepAliveMinutes;
  const modeChanged = settings !== null && mode !== settings.defaultPermissionMode;
  const defaultBackendChanged = settings !== null && defaultBackend !== settings.defaultBackend;
  // A rule left without a skill is dropped rather than refused.
  const rulesToSave = rules.filter((r) => r.skill.trim());
  const rulesChanged = settings !== null && JSON.stringify(rulesToSave) !== JSON.stringify(settings.automations);
  const keepAliveOptions = KEEP_ALIVE.some((o) => o.minutes === keepAlive)
    ? KEEP_ALIVE
    : [...KEEP_ALIVE, { minutes: keepAlive, label: `${keepAlive} minutes` }];
  const dirty = unsavedPages({
    prompt: promptChanged,
    keepAlive: keepAliveChanged,
    mode: modeChanged,
    backend: defaultBackendChanged,
    rules: rulesChanged,
  });

  async function save() {
    if (!settings) return;
    const patch: Parameters<typeof api.saveSettings>[0] = {};
    // Saving the default text clears the custom prompt, so later default changes still apply.
    if (promptChanged) patch.threadPrompt = isDefaultPrompt ? "" : prompt;
    if (keepAliveChanged) patch.keepAliveMinutes = keepAlive;
    if (modeChanged) patch.defaultPermissionMode = mode;
    if (defaultBackendChanged) patch.defaultBackend = defaultBackend;
    if (rulesChanged) patch.automations = rulesToSave;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await api.saveSettings(patch);
      onClose();
    } catch (err) {
      setSaveError(message(err));
      setSaving(false);
    }
  }

  // What each page draws: a few cards. Pages in NEEDS_SETTINGS only draw once the server's settings are in.
  function pageBody(s: SettingsView): ReactNode {
    switch (page) {
      case "general":
        return (
          <>
            <Card>
              <section className="flex flex-col gap-3">
                <SectionHeader title="Appearance" hint="Changes right away. System follows your computer&apos;s setting; a scene puts its picture behind the board." />
                <AppearancePicker />
              </section>
            </Card>
            <Card>
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
            </Card>
            <Card>
              <SoundSettings titleClass={TITLE} hintClass={HINT} />
            </Card>
            <Card>
              <LaptopModeCard />
            </Card>
          </>
        );
      case "models":
        return (
          <Card>
            <NewThreadDefaults
              backend={defaultBackend}
              onBackend={(next) => {
                setDefaultBackend(next);
                setSaveError(null);
              }}
            />
            <SubagentPicker value={s.subagentModel} />
            <DonePicker model={s.doneModel} effort={s.doneEffort} />
          </Card>
        );
      case "threads":
        return (
          <>
            <Card>
              <section className="flex items-center justify-between gap-4">
                <SectionHeader title="Default permission mode" hint="What a new thread starts in. You can still change it per thread." />
                <ModePicker
                  value={mode}
                  onChange={(next) => {
                    setMode(next);
                    setSaveError(null);
                  }}
                />
              </section>
              <section className="flex items-center justify-between gap-4">
                <SectionHeader title="Keep conversations open" hint={`A thread's CLI stays open between messages so replies start right away.`} />
                <select value={keepAlive} aria-label="Keep conversations open" onChange={(e) => { setKeepAlive(Number(e.target.value)); setSaveError(null); }} className={SELECT_CLASS}>
                  {keepAliveOptions.map((o) => (
                    <option key={o.minutes} value={o.minutes}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </section>
            </Card>
            <Card>
              <section className="flex flex-col gap-2">
                <SectionHeader
                  title="Thread instructions"
                  hint={`Added to every thread's system prompt. The board reads the BOARD STATUS line it asks for, so keep that line's format.`}
                />
                <textarea
                  rows={18}
                  value={prompt}
                  spellCheck={false}
                  aria-label="Thread instructions"
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    setSaveError(null);
                  }}
                  className="w-full resize-y rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-accent"
                />
                <div className="flex items-start justify-between gap-4">
                  <p className="text-[12px] text-faint">
                    Takes effect for threads that start after you save; threads already open keep their instructions.
                  </p>
                  <button
                    onClick={() => setPrompt(s.defaultThreadPrompt)}
                    disabled={isDefaultPrompt}
                    className="shrink-0 text-[12.5px] text-accent hover:underline disabled:text-faint disabled:no-underline"
                  >
                    Reset to default
                  </button>
                </div>
              </section>
            </Card>
          </>
        );
      case "automations":
        return (
          <Card>
            <AutomationSettings
              rules={rules}
              pushOnDone={s.pushOnDone}
              onChange={(next) => {
                setRules(next);
                setSaveError(null);
              }}
            />
          </Card>
        );
      case "shortcuts":
        return (
          <Card>
            <ShortcutSettings titleClass={TITLE} hintClass={HINT} />
          </Card>
        );
      case "accounts":
        return (
          <>
            <Card>
              <AccountSettings titleClass={TITLE} hintClass={HINT} />
            </Card>
            <Card>
              <CliLogins titleClass={TITLE} />
            </Card>
          </>
        );
      case "team":
        // TeamSettings draws its own cards, one per section.
        return <TeamSettings />;
    }
  }

  function content() {
    if (settings === null && NEEDS_SETTINGS.has(page)) {
      return (
        <Card>
          {loadError !== null ? (
            <p className="text-[12.5px] text-danger">Couldn&apos;t load settings: {loadError}</p>
          ) : (
            <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-muted">
              <Spinner /> Loading settings
            </div>
          )}
        </Card>
      );
    }
    // The pages drawn before the server answers never read `settings`.
    return pageBody(settings ?? ({} as SettingsView));
  }

  const open = pageInfo(page);

  return (
    <Modal
      label="Settings"
      onClose={onClose}
      className="h-full w-full overflow-hidden"
      style={{ background: `${SCRIM[scene.base]}, url(${sceneUrl(scene.id)}) center 62% / cover no-repeat, var(--canvas)` }}
    >
      <div
        // The whole panel is the scene photo; a mousedown anywhere on it closes, like a backdrop.
        // The panes below (header, row, footer) stop the event so clicks on them keep working.
        onMouseDown={onClose}
        className="flex h-full min-h-0 flex-col"
      >
        <div
          onMouseDown={(e) => e.stopPropagation()}
          className="flex shrink-0 items-center justify-between border-b border-line bg-panel/80 px-5 py-3 backdrop-blur-xl"
        >
          <h2 className="text-[15px] font-medium text-ink">Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 gap-4 p-4">
          <nav
            aria-label="Settings pages"
            onMouseDown={(e) => e.stopPropagation()}
            className="flex w-[200px] shrink-0 flex-col gap-0.5 self-start rounded-xl border border-line-strong bg-panel/80 p-2 shadow-lg backdrop-blur-xl"
          >
            {SETTINGS_PAGES.map((p) => {
              const active = p.id === page;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => setPage(p.id)}
                  className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] ${
                    active ? "bg-accent-soft font-medium text-ink" : "text-muted hover:bg-sunken hover:text-ink"
                  }`}
                >
                  {p.label}
                  {dirty.has(p.id) && <UnsavedDot />}
                </button>
              );
            })}
          </nav>

          <div className="flex h-full min-h-0 min-w-0 max-w-[760px] flex-1 flex-col gap-4 overflow-y-auto pb-4 pr-2">
            <div className="px-1 pt-1 [text-shadow:0_1px_8px_rgb(0_0_0/0.35)]">
              <h2 className="text-[22px] font-semibold text-ink">{open.label}</h2>
              <p className="text-[13px] text-ink/80">{open.hint}</p>
            </div>
            {content()}
          </div>
        </div>

        <div
          onMouseDown={(e) => e.stopPropagation()}
          className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-panel/80 px-5 py-3 backdrop-blur-xl"
        >
          {saveError && <p className="mr-auto min-w-0 break-words text-[12.5px] text-danger">{saveError}</p>}
          <button
            onClick={onClose}
            className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-ink hover:bg-sunken"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={settings === null || saving}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Spinner size={12} />}
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
