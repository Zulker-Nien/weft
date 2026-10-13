"use client";

import { useEffect, useState, type ReactNode } from "react";
import { setShowBacklog, setShowProgress, showBacklog, showProgress } from "@/lib/board-prefs";
import { api } from "@/lib/client";
import {
  SETTINGS_NAV,
  firstTab,
  navSectionOf,
  rememberTab,
  rememberedTab,
  sectionOf,
  unsavedSections,
  unsavedTabs,
  type SettingsSection,
  type SettingsTab,
} from "@/lib/settings-nav";
import type { Automation, Backend, PermissionMode, SettingsView } from "@/lib/types";
import AccountSettings from "./AccountSettings";
import AppearancePicker from "./AppearancePicker";
import AutomationSettings from "./AutomationSettings";
import CliLogins from "./CliLogins";
import DonePicker from "./DonePicker";
import { Spinner } from "./Icon";
import Modal from "./Modal";
import ModePicker from "./ModePicker";
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

// The tabs whose settings come from the server; the rest draw right away.
const NEEDS_SETTINGS = new Set<SettingsTab>(["defaults", "instructions", "subagents", "rules", "done"]);

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

// A section's title and hint, stacked at the top of its content. The same shape wraps every setting here.
function SectionHeader({
  titleClass,
  hintClass,
  title,
  hint,
}: {
  titleClass: string;
  hintClass: string;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className={titleClass}>{title}</h3>
      <p className={hintClass}>{hint}</p>
    </div>
  );
}

// The small accent dot on a nav item whose tab holds edits that wait for Save.
function UnsavedDot() {
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="Unsaved changes" />;
}

// Settings fills the window: main sections down the left, their tabs along the top, one tab's settings at a time.
// Appearance, board, sound, shortcut and account changes apply right away; the rest wait for Save.
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
  const [tab, setTabState] = useState<SettingsTab>(rememberedTab);
  // The tab last open in each section, so going back to a section lands where you were.
  const [sectionTabs, setSectionTabs] = useState<Partial<Record<SettingsSection, SettingsTab>>>(() => ({
    [sectionOf(rememberedTab())]: rememberedTab(),
  }));

  function setTab(next: SettingsTab) {
    rememberTab(next);
    setTabState(next);
    setSectionTabs((m) => ({ ...m, [sectionOf(next)]: next }));
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
  const dirtyTabs = unsavedTabs({
    prompt: promptChanged,
    keepAlive: keepAliveChanged,
    mode: modeChanged,
    backend: defaultBackendChanged,
    rules: rulesChanged,
  });
  const dirtySections = unsavedSections(dirtyTabs);

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

  const sectionTitle = "text-[13px] font-medium text-ink";
  const sectionHint = "text-[12.5px] text-muted";
  const selectClass =
    "rounded-md border border-line-strong bg-canvas px-2.5 py-[7px] text-[12.5px] text-ink outline-none focus:border-accent";
  const section = navSectionOf(tab);

  // What each tab draws. Tabs in NEEDS_SETTINGS only draw once the server's settings are in.
  function body(s: SettingsView): Record<SettingsTab, ReactNode> {
    return {
      appearance: (
        <section className="flex flex-col gap-2">
          <SectionHeader titleClass={sectionTitle} hintClass={sectionHint} title="Appearance" hint="Changes right away. System follows your computer&apos;s setting; a scene puts its picture behind the board." />
          <AppearancePicker />
        </section>
      ),
      board: (
        <>
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
        </>
      ),
      sounds: <SoundSettings titleClass={sectionTitle} hintClass={sectionHint} />,
      shortcuts: <ShortcutSettings titleClass={sectionTitle} hintClass={sectionHint} />,
      defaults: (
        <>
          <section className="flex items-center justify-between gap-4">
            <SectionHeader titleClass={sectionTitle} hintClass={sectionHint} title="Default CLI" hint="What new threads start on. You can still switch mid-flight from a card&apos;s menu." />
            <select value={defaultBackend} aria-label="Default CLI" onChange={(e) => { setDefaultBackend(e.target.value as Backend); setSaveError(null); }} className={selectClass}>
              <option value="claude">Claude Code</option> <option value="puku">puku-cli</option>
            </select>
          </section>
          <section className="flex items-center justify-between gap-4">
            <SectionHeader titleClass={sectionTitle} hintClass={sectionHint} title="Default permission mode" hint="What a new thread starts in. You can still change it per thread." />
            <ModePicker
              value={mode}
              onChange={(next) => {
                setMode(next);
                setSaveError(null);
              }}
            />
          </section>
          <section className="flex items-center justify-between gap-4">
            <SectionHeader titleClass={sectionTitle} hintClass={sectionHint} title="Keep conversations open" hint={`A thread's CLI stays open between messages so replies start right away.`} />
            <select value={keepAlive} aria-label="Keep conversations open" onChange={(e) => { setKeepAlive(Number(e.target.value)); setSaveError(null); }} className={selectClass}>
              {keepAliveOptions.map((o) => (
                <option key={o.minutes} value={o.minutes}>
                  {o.label}
                </option>
              ))}
            </select>
          </section>
        </>
      ),
      instructions: (
        <section className="flex min-h-0 flex-1 flex-col gap-2">
          <SectionHeader
            titleClass={sectionTitle}
            hintClass={sectionHint}
            title="Thread instructions"
            hint={`Added to every thread's system prompt. The board reads the BOARD STATUS line it asks for, so keep that line's format.`}
          />
          <textarea
            value={prompt}
            spellCheck={false}
            aria-label="Thread instructions"
            onChange={(e) => {
              setPrompt(e.target.value);
              setSaveError(null);
            }}
            className="min-h-[240px] w-full flex-1 resize-none rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-accent"
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
      ),
      subagents: <SubagentPicker value={s.subagentModel} />,
      rules: (
        <AutomationSettings
          rules={rules}
          pushOnDone={s.pushOnDone}
          onChange={(next) => {
            setRules(next);
            setSaveError(null);
          }}
        />
      ),
      done: <DonePicker model={s.doneModel} effort={s.doneEffort} />,
      account: <AccountSettings titleClass={sectionTitle} hintClass={sectionHint} />,
      clis: <CliLogins titleClass={sectionTitle} />,
    };
  }

  function content() {
    if (settings === null && NEEDS_SETTINGS.has(tab)) {
      if (loadError !== null) return <p className="text-[12.5px] text-danger">Couldn&apos;t load settings: {loadError}</p>;
      return (
        <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-muted">
          <Spinner /> Loading settings
        </div>
      );
    }
    // The tabs drawn here before the server answers never read `settings`.
    return body(settings ?? ({} as SettingsView))[tab];
  }

  return (
    <Modal title="Settings" onClose={onClose} className="h-full w-full">
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Settings sections" className="flex w-[180px] shrink-0 flex-col gap-0.5 border-r border-line p-2">
          {SETTINGS_NAV.map((s) => {
            const active = s.id === section.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setTab(firstTab(s.id, sectionTabs))}
                className={`flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-[13px] ${
                  active ? "bg-line font-medium text-ink" : "text-muted hover:bg-sunken hover:text-ink"
                }`}
              >
                {s.label}
                {dirtySections.has(s.id) && <UnsavedDot />}
              </button>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div role="tablist" aria-label={section.label} className="flex shrink-0 gap-5 border-b border-line px-6">
            {section.tabs.map((t) => {
              const active = t.id === tab;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className={`-mb-px flex items-center gap-1.5 border-b-2 py-2.5 text-[13px] ${
                    active ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {t.label}
                  {dirtyTabs.has(t.id) && <UnsavedDot />}
                </button>
              );
            })}
          </div>
          <div role="tabpanel" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5">
            <div className="flex w-full max-w-[720px] flex-1 flex-col gap-6">{content()}</div>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
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
    </Modal>
  );
}
