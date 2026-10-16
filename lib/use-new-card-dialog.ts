"use client";

// The New thread dialog's state, draft, defaults and submit behavior. Extracted from
// components/NewCardDialog.tsx so the dialog body and its logic can change on their own schedule.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type NewCardInput } from "@/lib/client";
import type { Backend, Effort, PermissionMode } from "@/lib/types";
import {
  DRAFT,
  LAST_BACKEND,
  LAST_CWD,
  effortFor,
  errorText,
  headline,
  lastEffort,
  modelFor,
  problemWith,
  remember,
  rememberPicks,
  remembered,
} from "@/lib/new-thread";

// The dialog's state and the actions that drive it.
export interface NewCardDialogLogic {
  cwd: string;
  setCwd: (folder: string) => void;
  backend: Backend;
  setBackend: (b: Backend) => void;
  model: string;
  setModel: (m: string) => void;
  effort: Effort | "";
  setEffort: (e: Effort | "") => void;
  permissionMode: PermissionMode;
  setPermissionMode: (m: PermissionMode) => void;
  error: string | null;
  busy: false | "start" | "backlog";
  started: string | null;
  draftInitial: string;
  saveDraft: (markdown: string) => void;
  pickBackend: (b: Backend) => void;
  pickMode: (m: PermissionMode) => void;
  chooseFolder: (folder: string) => void;
  promptToStart: (read: () => string, focus: () => void) => string | null;
  submit: (
    start: boolean,
    opts: { stay: boolean; read: () => string; clear: () => void; focus: () => void; onCreate: (input: NewCardInput, opts?: { stay?: boolean }) => Promise<void>; onClose: () => void },
  ) => Promise<void>;
}

// Resolves the initial cwd: the defaultCwd (the project's own), then the last cwd if it isn't home,
// then the recent cwd, then the last cwd even if it is home, then home.
function pickInitialCwd(home: string, defaultCwd: string | undefined, recentCwd: string | undefined): string {
  const last = remembered(LAST_CWD);
  return (
    defaultCwd ??
    (last && last !== home ? last : undefined) ??
    recentCwd ??
    last ??
    home
  );
}

// The dialog's effect: load Settings' defaults (defaultBackend, defaultPermissionMode) if the user
// hasn't picked one yet.
function useSettingsDefaults(
  pickedMode: React.RefObject<boolean>,
  pickedBackend: React.RefObject<boolean>,
  setPermissionMode: (m: PermissionMode) => void,
  setBackend: (b: Backend) => void,
  setModel: (m: string) => void,
) {
  useEffect(() => {
    api.settings().then(
      (s) => {
        if (!pickedMode.current) setPermissionMode(s.defaultPermissionMode);
        if (!pickedBackend.current) {
          setBackend(s.defaultBackend);
          setModel(modelFor(s.defaultBackend));
        }
      },
      () => {},
    );
  }, [pickedMode, pickedBackend, setPermissionMode, setBackend, setModel]);
}

// The dialog's state, draft and submit: a single hook so callers don't have to wire the pieces.
export function useNewCardDialog(home: string, defaultCwd: string | undefined, recentCwd: string | undefined): NewCardDialogLogic {
  const [draftInitial] = useState(() => remembered(DRAFT) ?? "");
  const [cwd, setCwd] = useState(() => pickInitialCwd(home, defaultCwd, recentCwd));
  const [backend, setBackend] = useState<Backend>(() => (remembered(LAST_BACKEND) as Backend | null) ?? "claude");
  const pickedBackend = useRef(false);
  const [model, setModel] = useState(() => modelFor(backend));
  const [effort, setEffort] = useState<Effort | "">(lastEffort);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("auto");
  const pickedMode = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<false | "start" | "backlog">(false);
  const [started, setStarted] = useState<string | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useSettingsDefaults(pickedMode, pickedBackend, setPermissionMode, setBackend, setModel);
  useEffect(() => () => clearTimeout(draftTimer.current), []);

  const saveDraft = useCallback((markdown: string) => {
    setError(null);
    setStarted(null);
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(
      () => remember(DRAFT, markdown.trim() ? markdown : null),
      300,
    );
  }, []);

  const pickBackend = useCallback((b: Backend) => {
    pickedBackend.current = true;
    setBackend(b);
    setModel(modelFor(b));
  }, []);

  const pickMode = useCallback((m: PermissionMode) => {
    pickedMode.current = true;
    setPermissionMode(m);
  }, []);

  const chooseFolder = useCallback((folder: string) => {
    setCwd(folder);
    setError(null);
    api.warm({ cwd: folder, backend }).catch(() => {});
  }, [backend]);

  const promptToStart = useCallback((read: () => string, focus: () => void) => {
    let prompt: string;
    try {
      prompt = read();
    } catch (err) {
      setError(errorText(err));
      return null;
    }
    const problem = problemWith(prompt);
    if (!problem) return prompt;
    setError(problem);
    focus();
    return null;
  }, []);

  const submit = useCallback(
    async (
      start: boolean,
      opts: { stay: boolean; read: () => string; clear: () => void; focus: () => void; onCreate: (input: NewCardInput, opts?: { stay?: boolean }) => Promise<void>; onClose: () => void },
    ) => {
      if (busy) return;
      const prompt = promptToStart(opts.read, opts.focus);
      if (prompt === null) return;
      setBusy(start ? "start" : "backlog");
      try {
        const input: NewCardInput = {
          prompt,
          cwd,
          backend,
          permissionMode,
          model,
          effort: effortFor(backend, effort),
          start,
        };
        if (opts.stay) await opts.onCreate(input, { stay: true });
        else await opts.onCreate(input);
        clearTimeout(draftTimer.current);
        remember(DRAFT, null);
        rememberPicks({ cwd, backend, model, effort });
        if (!opts.stay) {
          opts.onClose();
          return;
        }
        opts.clear();
        setStarted(headline(prompt));
        setBusy(false);
        opts.focus();
      } catch (err) {
        setError(errorText(err));
        setBusy(false);
      }
    },
    [busy, cwd, backend, permissionMode, model, effort, promptToStart],
  );

  return {
    cwd,
    setCwd,
    backend,
    setBackend,
    model,
    setModel,
    effort,
    setEffort,
    permissionMode,
    setPermissionMode,
    error,
    busy,
    started,
    draftInitial,
    saveDraft,
    pickBackend,
    pickMode,
    chooseFolder,
    promptToStart,
    submit,
  };
}
