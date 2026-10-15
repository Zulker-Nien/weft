"use client";

import { useEffect, useRef, useState } from "react";
import { api, type NewCardInput } from "@/lib/client";
import type { Backend, Effort, PermissionMode } from "@/lib/types";
import {
  BACKENDS,
  DRAFT,
  EFFORTS,
  LAST_BACKEND,
  LAST_CWD,
  MODELS,
  effortFor,
  errorText,
  headline,
  lastEffort,
  modelFor,
  problemWith,
  remember,
  rememberPicks,
  remembered,
  startButton,
} from "@/lib/new-thread";
import Composer, { type ComposerHandle } from "./Composer";
import Icon, { Spinner } from "./Icon";
import ModePicker from "./ModePicker";
import { alsoHereLine, busyInFolder } from "@/lib/overlap";
import type { Card } from "@/lib/types";
import RepoPicker from "./RepoPicker";
import { useEscape } from "@/lib/use-escape";
import { useHeldModifiers } from "@/lib/use-mod-held";

export default function NewCardDialog({
  cards = [],
  home,
  defaultCwd,
  recentCwd,
  onClose,
  onCreate,
}: {
  // The board's cards, to warn when the chosen folder already has busy ones (lib/overlap.ts).
  cards?: Card[];
  home: string;
  // The selected project, if any; otherwise the last folder used.
  defaultCwd?: string;
  // Folder of the most recently active card outside home, used when nothing else is remembered.
  recentCwd?: string;
  onClose: () => void;
  // stay: started with ⌃↵, so the dialog stays open for the next thread.
  onCreate: (input: NewCardInput, opts?: { stay?: boolean }) => Promise<void>;
}) {
  const [initial] = useState(() => remembered(DRAFT) ?? "");
  const [cwd, setCwd] = useState(() => {
    // Home isn't a project, so only fall back to it when nothing better is known.
    const last = remembered(LAST_CWD);
    return (
      defaultCwd ??
      (last && last !== home ? last : undefined) ??
      recentCwd ??
      last ??
      home
    );
  });
  const [backend, setBackend] = useState<Backend>(
    () => (remembered(LAST_BACKEND) as Backend | null) ?? "claude",
  );
  const pickedBackend = useRef(false);
  const [model, setModel] = useState(() => modelFor(backend));
  const [effort, setEffort] = useState<Effort | "">(lastEffort);
  // Starts in Settings' default mode, unless you pick one before it loads.
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("auto");
  const pickedMode = useRef(false);
  // Cards get no worktree, so a busy card in this folder would share its working tree.
  const alsoHere = busyInFolder(cards, cwd);
  const [error, setError] = useState<string | null>(null);
  // Which button is waiting on the server, so it can say so instead of just going dim.
  const [busy, setBusy] = useState<false | "start" | "backlog">(false);
  // The title of the thread ⌃↵ just started, while the dialog waits for the next one.
  const [started, setStarted] = useState<string | null>(null);
  // ⌘ or ⌃ held: the Start button names what ⌘↵ or ⌃↵ will do.
  const startBtn = startButton(useHeldModifiers());
  const composer = useRef<ComposerHandle>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEscape(true, onClose);

  useEffect(() => () => clearTimeout(draftTimer.current), []);

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
  }, []);

  function saveDraft(markdown: string) {
    setError(null);
    setStarted(null);
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(
      () => remember(DRAFT, markdown.trim() ? markdown : null),
      300,
    );
  }

  function chooseFolder(folder: string) {
    setCwd(folder);
    setError(null);
    // Have a CLI ready there by the time the prompt is written.
    api.warm({ cwd: folder, backend }).catch(() => {});
  }

  // The prompt as written, or null (the reason shown, the box focused) when it can't start yet.
  function promptToStart() {
    try {
      const prompt = composer.current?.read() ?? "";
      const problem = problemWith(prompt);
      if (!problem) return prompt;
      setError(problem);
      composer.current?.focus();
    } catch (err) {
      setError(errorText(err));
    }
    return null;
  }

  // The thread is made: drop the draft, keep the picks for the next one, then close, or (stay) empty the box.
  function afterCreate(prompt: string, stay: boolean) {
    clearTimeout(draftTimer.current);
    remember(DRAFT, null);
    rememberPicks({ cwd, backend, model, effort });
    if (!stay) {
      onClose();
      return;
    }
    composer.current?.clear();
    setStarted(headline(prompt));
    setBusy(false);
    composer.current?.focus();
  }

  // stay (⌃↵) starts the thread and leaves the dialog open, emptied, for another in the same folder.
  async function submit(start: boolean, stay = false) {
    if (busy) return;
    const prompt = promptToStart();
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
      await (stay ? onCreate(input, { stay }) : onCreate(input));
      afterCreate(prompt, stay);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  // The prompt is saved as a draft as it's typed, so Escape or a click outside keeps it.
  return (
    <aside className="flex w-[44%] min-w-[380px] shrink-0 flex-col bg-panel last:flex-1">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="min-w-0 truncate text-[15px] font-medium text-ink">
          New thread
        </h2>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-5 pt-3">
        <Composer
          ref={composer}
          variant="dialog"
          cwd={cwd}
          autoFocus
          initial={initial}
          onChange={saveDraft}
          onSubmit={() => void submit(true)}
          onSubmitAlt={() => void submit(true, true)}
          placeholder="What should this thread do? Paste screenshots or videos right where they belong, or hit the mic and talk."
          sizeClass="h-full min-h-[180px]"
          className="flex-1"
        />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pt-3">
        <RepoPicker value={cwd} home={home} onChange={chooseFolder} />

        <label className="relative flex items-center gap-1.5 rounded-md border border-line-strong py-1.5 pl-2.5 pr-1.5 text-[12px] text-ink">
          <span className="sr-only">Model</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="cursor-pointer appearance-none bg-transparent pr-4 font-medium outline-none"
          >
            {MODELS[backend].map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <Icon
            name="chevronDown"
            size={12}
            className="pointer-events-none absolute right-1.5"
          />
        </label>

        {backend !== "puku" && (
          <label
            className="relative flex items-center gap-1.5 rounded-md border border-line-strong py-1.5 pl-2.5 pr-1.5 text-[12px] text-ink"
            title="How hard the model thinks before answering"
          >
            <span className="sr-only">Effort</span>
            <select
              value={effort}
              onChange={(e) => setEffort(e.target.value as Effort | "")}
              className="cursor-pointer appearance-none bg-transparent pr-4 font-medium outline-none"
            >
              {EFFORTS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
            <Icon
              name="chevronDown"
              size={12}
              className="pointer-events-none absolute right-1.5"
            />
          </label>
        )}

        <ModePicker
          backend={backend}
          value={permissionMode}
          onChange={(mode) => {
            pickedMode.current = true;
            setPermissionMode(mode);
          }}
        />
      </div>

      <div className="flex shrink-0 items-center gap-3 px-5 pb-4 pt-3">
        <div
          className="flex rounded-md border border-line-strong p-0.5"
          role="group"
          aria-label="CLI"
        >
          {BACKENDS.map((b) => (
            <button
              key={b.id}
              type="button"
              title={b.id === "codex" ? "Requires Codex CLI and login. Weft's browser, board, secrets and webhook tools are unavailable." : undefined}
              onClick={() => {
                pickedBackend.current = true;
                setBackend(b.id);
                setModel(modelFor(b.id));
              }}
              aria-pressed={backend === b.id}
              className={`rounded px-2.5 py-1 text-[12px] ${backend === b.id ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink"}`}
            >
              {b.label}
            </button>
          ))}
        </div>
        <p className="min-w-0 flex-1 truncate text-[12px]">
          {error ? (
            <span className="text-danger">{error}</span>
          ) : alsoHere.length > 0 ? (
            <span
              className="flex min-w-0 items-center gap-1.5 text-warn"
              title={`These threads share this folder's working tree:\n${alsoHere.map((c) => c.title).join("\n")}`}
            >
              <Icon name="alert" size={12} className="shrink-0" />
              <span className="truncate">{alsoHereLine(alsoHere)}</span>
            </span>
          ) : started ? (
            <span className="text-muted">
              Started “{started}” · write the next one
            </span>
          ) : (
            <span className="text-faint">
              <kbd className="font-sans">⌘↵</kbd> starts it ·{" "}
              <kbd className="font-sans">⌃↵</kbd> starts it and stays open
            </span>
          )}
        </p>
        <button
          onClick={() => void submit(false)}
          disabled={!!busy}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-ink hover:bg-sunken disabled:cursor-wait disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {busy === "backlog" && <Spinner size={12} />}
          {busy === "backlog" ? "Adding…" : "Add to backlog"}
        </button>
        <button
          onClick={() => void submit(true)}
          disabled={!!busy}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-on-accent hover:opacity-90 disabled:cursor-wait disabled:opacity-40 disabled:saturate-0"
        >
          {busy === "start" ? (
            <>
              <Spinner size={12} />
              Starting…
            </>
          ) : (
            <>
              {startBtn.label}
              <kbd aria-hidden="true" className="font-sans font-normal opacity-60">
                {startBtn.key}
              </kbd>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
