"use client";

import { useEffect, useRef, useState } from "react";
import { api, type NewCardInput } from "@/lib/client";
import type { Backend, PermissionMode } from "@/lib/types";
import Composer, { type ComposerHandle } from "./Composer";
import Icon from "./Icon";
import RepoPicker from "./RepoPicker";

const LAST_CWD = "threadboard.cwd";
const LAST_BACKEND = "threadboard.backend";
// What you were writing, kept if the dialog closes before the thread is created.
const DRAFT = "weft.newThreadDraft";

function remembered(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

const BACKENDS: { id: Backend; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "puku", label: "puku-cli" },
];

const MODES: { id: PermissionMode; label: string; hint: string }[] = [
  { id: "bypassPermissions", label: "YOLO", hint: "Runs every tool without asking" },
  { id: "auto", label: "Auto", hint: "A classifier approves or asks" },
  { id: "acceptEdits", label: "Accept edits", hint: "Edits files freely, asks before commands" },
  { id: "default", label: "Ask me", hint: "Asks before each tool" },
];

export default function NewCardDialog({
  home,
  defaultCwd,
  onClose,
  onCreate,
}: {
  home: string;
  // The selected project, if any; otherwise the last folder used.
  defaultCwd?: string;
  onClose: () => void;
  onCreate: (input: NewCardInput) => Promise<void>;
}) {
  const [initial] = useState(() => remembered(DRAFT) ?? "");
  const [cwd, setCwd] = useState(() => defaultCwd ?? remembered(LAST_CWD) ?? home);
  const [backend, setBackend] = useState<Backend>(() => (remembered(LAST_BACKEND) as Backend | null) ?? "claude");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("bypassPermissions");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => () => clearTimeout(draftTimer.current), []);

  function saveDraft(markdown: string) {
    setError(null);
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => remember(DRAFT, markdown.trim() ? markdown : null), 300);
  }

  function chooseFolder(folder: string) {
    setCwd(folder);
    setError(null);
    // Have a CLI ready there by the time the prompt is written.
    api.warm({ cwd: folder, backend }).catch(() => {});
  }

  async function submit(start: boolean) {
    if (busy) return;
    let prompt: string;
    try {
      prompt = composer.current?.read() ?? "";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!prompt) {
      setError("Write a prompt first.");
      composer.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await onCreate({ prompt, cwd, backend, permissionMode, start });
      clearTimeout(draftTimer.current);
      remember(DRAFT, null);
      remember(LAST_CWD, cwd);
      remember(LAST_BACKEND, backend);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const mode = MODES.find((m) => m.id === permissionMode) ?? MODES[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-labelledby="new-thread-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-[min(820px,calc(100vh-24px))] w-full max-w-[920px] flex-col rounded-xl border border-line bg-panel shadow-2xl sm:h-[min(820px,calc(100vh-48px))]"
      >
        <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-4">
          <h2 id="new-thread-title" className="text-[15px] font-medium text-ink">
            New thread
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-5">
          <Composer
            ref={composer}
            variant="dialog"
            autoFocus
            initial={initial}
            onChange={saveDraft}
            onSubmit={() => void submit(true)}
            placeholder="What should this thread do? Paste screenshots or videos right where they belong, or hit the mic and talk."
            sizeClass="h-full min-h-[180px]"
            className="flex-1"
          />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pt-3">
          <RepoPicker value={cwd} home={home} onChange={chooseFolder} />

          <div className="flex rounded-md border border-line-strong p-0.5" role="group" aria-label="CLI">
            {BACKENDS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setBackend(b.id)}
                aria-pressed={backend === b.id}
                className={`rounded px-2.5 py-1 text-[12px] ${backend === b.id ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink"}`}
              >
                {b.label}
              </button>
            ))}
          </div>

          <label
            className={`relative flex items-center gap-1.5 rounded-md border py-1.5 pl-2.5 pr-1.5 text-[12px] ${
              permissionMode === "bypassPermissions" ? "border-warn/50 bg-warn-soft text-warn" : "border-line-strong text-ink"
            }`}
            title={mode.hint}
          >
            <Icon name={permissionMode === "bypassPermissions" ? "zap" : "shield"} size={13} />
            <span className="sr-only">Permissions</span>
            <select
              value={permissionMode}
              onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
              className="cursor-pointer appearance-none bg-transparent pr-4 font-medium outline-none"
            >
              {MODES.map((m) => (
                <option key={m.id} value={m.id} title={m.hint}>
                  {m.label}
                </option>
              ))}
            </select>
            <Icon name="chevronDown" size={12} className="pointer-events-none absolute right-1.5" />
          </label>
        </div>

        <div className="flex shrink-0 items-center gap-3 px-5 pb-4 pt-3">
          <p className="min-w-0 flex-1 truncate text-[12px]">
            {error ? (
              <span className="text-danger">{error}</span>
            ) : (
              <span className="text-faint">
                <kbd className="font-sans">⌘↵</kbd> starts it · the title comes from the prompt
              </span>
            )}
          </p>
          <button
            onClick={() => void submit(false)}
            disabled={busy}
            className="shrink-0 rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-ink hover:bg-sunken disabled:opacity-50"
          >
            Add to backlog
          </button>
          <button
            onClick={() => void submit(true)}
            disabled={busy}
            className="shrink-0 rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            Start now
          </button>
        </div>
      </div>
    </div>
  );
}
