"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { Backend, CliStatus, SettingsView } from "@/lib/types";
import Icon, { Spinner } from "./Icon";

const KEEP_ALIVE: { minutes: number; label: string }[] = [
  { minutes: 0, label: "Until the app quits" },
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 15, label: "15 minutes" },
];

const CLIS: { id: Backend; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "puku", label: "puku-cli" },
];

// How long "Login started" shows after clicking Log in.
const STARTED_MS = 4000;

type LoginStatus =
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "ready"; status: Record<Backend, CliStatus> };

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function statusLine(s: CliStatus | undefined): { text: string; dot: string } {
  if (!s) return { text: "Unknown", dot: "bg-faint" };
  if (s.error) return { text: s.error, dot: "bg-danger" };
  if (s.loggedIn) return { text: s.email ? `Logged in as ${s.email}` : "Logged in", dot: "bg-ok" };
  return { text: "Not logged in", dot: "bg-warn" };
}

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [keepAlive, setKeepAlive] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [login, setLogin] = useState<LoginStatus>({ kind: "loading" });
  const [starting, setStarting] = useState<Backend | null>(null);
  const [started, setStarted] = useState<Partial<Record<Backend, boolean>>>({});
  const [startError, setStartError] = useState<Partial<Record<Backend, string>>>({});
  const timers = useRef(new Map<Backend, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => clearTimeout(t));
  }, []);

  // Only sets state once the request settles, so it's safe to call from an effect.
  const fetchLoginStatus = useCallback(
    () =>
      api.loginStatus().then(
        (r) => setLogin({ kind: "ready", status: r.status }),
        (err) => setLogin({ kind: "error", error: message(err) }),
      ),
    [],
  );

  useEffect(() => {
    let ignore = false;
    api.settings().then(
      (s) => {
        if (ignore) return;
        setSettings(s);
        setPrompt(s.threadPrompt);
        setKeepAlive(s.keepAliveMinutes);
      },
      (err) => {
        if (!ignore) setLoadError(message(err));
      },
    );
    void fetchLoginStatus();
    return () => {
      ignore = true;
    };
  }, [fetchLoginStatus]);

  function refreshLoginStatus() {
    setLogin({ kind: "loading" });
    setStartError({});
    void fetchLoginStatus();
  }

  async function startLogin(backend: Backend) {
    setStarting(backend);
    setStartError((e) => ({ ...e, [backend]: undefined }));
    try {
      await api.login(backend, "start");
      setStarted((s) => ({ ...s, [backend]: true }));
      clearTimeout(timers.current.get(backend));
      timers.current.set(
        backend,
        setTimeout(() => setStarted((s) => ({ ...s, [backend]: false })), STARTED_MS),
      );
    } catch (err) {
      setStartError((e) => ({ ...e, [backend]: message(err) }));
    } finally {
      setStarting(null);
    }
  }

  const isDefaultPrompt = settings !== null && prompt.trim() === settings.defaultThreadPrompt.trim();
  const promptChanged = settings !== null && prompt.trim() !== settings.threadPrompt.trim();
  const keepAliveChanged = settings !== null && keepAlive !== settings.keepAliveMinutes;
  const keepAliveOptions = KEEP_ALIVE.some((o) => o.minutes === keepAlive)
    ? KEEP_ALIVE
    : [...KEEP_ALIVE, { minutes: keepAlive, label: `${keepAlive} minutes` }];

  async function save() {
    if (!settings) return;
    const patch: { threadPrompt?: string; keepAliveMinutes?: number } = {};
    // Saving the default text clears the custom prompt, so later default changes still apply.
    if (promptChanged) patch.threadPrompt = isDefaultPrompt ? "" : prompt;
    if (keepAliveChanged) patch.keepAliveMinutes = keepAlive;
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-[640px] flex-col rounded-xl border border-line bg-panel shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id="settings-title" className="text-[15px] font-medium text-ink">
            Settings
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink">
            <Icon name="x" size={16} />
          </button>
        </div>

        {settings === null && loadError === null ? (
          <div className="flex items-center justify-center gap-2 px-5 py-16 text-[13px] text-muted">
            <Spinner /> Loading settings
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
            {loadError !== null && (
              <p className="text-[12.5px] text-danger">Couldn&apos;t load settings: {loadError}</p>
            )}

            {settings !== null && (
              <>
                <section className="flex flex-col gap-2">
                  <div className="flex flex-col gap-0.5">
                    <h3 className={sectionTitle}>Thread instructions</h3>
                    <p className={sectionHint}>
                      Added to every thread&apos;s system prompt. The board reads the BOARD STATUS line it asks for,
                      so keep that line&apos;s format.
                    </p>
                  </div>
                  <textarea
                    rows={14}
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
                      Takes effect for threads that start after you save; threads already open keep their
                      instructions.
                    </p>
                    <button
                      onClick={() => setPrompt(settings.defaultThreadPrompt)}
                      disabled={isDefaultPrompt}
                      className="shrink-0 text-[12.5px] text-accent hover:underline disabled:text-faint disabled:no-underline"
                    >
                      Reset to default
                    </button>
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <div className="flex flex-col gap-0.5">
                    <h3 className={sectionTitle}>Keep conversations open</h3>
                    <p className={sectionHint}>A thread&apos;s CLI stays open between messages so replies start right away.</p>
                  </div>
                  <select
                    value={keepAlive}
                    aria-label="Keep conversations open"
                    onChange={(e) => {
                      setKeepAlive(Number(e.target.value));
                      setSaveError(null);
                    }}
                    className="w-fit rounded-md border border-line-strong bg-canvas px-2.5 py-[7px] text-[12.5px] text-ink outline-none focus:border-accent"
                  >
                    {keepAliveOptions.map((o) => (
                      <option key={o.minutes} value={o.minutes}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </section>
              </>
            )}

            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-4">
                <h3 className={sectionTitle}>CLIs</h3>
                <button
                  onClick={refreshLoginStatus}
                  disabled={login.kind === "loading"}
                  className="flex items-center gap-1 text-[12.5px] text-accent hover:underline disabled:text-faint disabled:no-underline"
                >
                  <Icon name="reload" size={12} />
                  Refresh
                </button>
              </div>

              {login.kind === "loading" ? (
                <div className="flex items-center gap-2 py-2 text-[12.5px] text-muted">
                  <Spinner size={12} /> Checking logins
                </div>
              ) : login.kind === "error" ? (
                <p className="break-words text-[12.5px] text-danger">Couldn&apos;t check logins: {login.error}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {CLIS.map((cli) => {
                    const s = login.status[cli.id];
                    const line = statusLine(s);
                    const error = startError[cli.id];
                    return (
                      <div key={cli.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5">
                        <span className="w-[96px] shrink-0 text-[13px] font-medium text-ink">{cli.label}</span>
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${line.dot}`} aria-hidden="true" />
                          <span className={`min-w-0 break-words text-[12.5px] ${s?.error ? "text-danger" : "text-muted"}`}>
                            {line.text}
                            {error && <span className="block text-danger">{error}</span>}
                          </span>
                        </span>
                        {started[cli.id] ? (
                          <span className="flex shrink-0 items-center gap-1 text-[12.5px] text-ok">
                            <Icon name="check" size={12} /> Login started
                          </span>
                        ) : (
                          s &&
                          !s.loggedIn && (
                            <button
                              onClick={() => void startLogin(cli.id)}
                              disabled={starting !== null}
                              className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50"
                            >
                              {starting === cli.id && <Spinner size={11} />}
                              Log in
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

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
      </div>
    </div>
  );
}
