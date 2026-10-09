"use client";

import { useEffect, useState } from "react";
import type { NewCardInput } from "@/lib/client";
import type { Backend, PermissionMode } from "@/lib/types";
import Icon from "./Icon";

const LAST_CWD = "threadboard.cwd";
const LAST_BACKEND = "threadboard.backend";

function remembered(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

const BACKENDS: { id: Backend; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "puku", label: "puku-cli" },
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
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState(() => defaultCwd ?? remembered(LAST_CWD) ?? home);
  const [backend, setBackend] = useState<Backend>(() => (remembered(LAST_BACKEND) as Backend | null) ?? "claude");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("default");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(start: boolean) {
    if (!prompt.trim()) {
      setError("Write a prompt first.");
      return;
    }
    setBusy(true);
    try {
      await onCreate({ title, prompt, cwd, backend, permissionMode, start });
      remember(LAST_CWD, cwd);
      remember(LAST_BACKEND, backend);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-accent";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-labelledby="new-thread-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[560px] rounded-xl border border-line bg-panel shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id="new-thread-title" className="text-[15px] font-medium text-ink">New thread</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-muted">Prompt</span>
            <textarea
              autoFocus
              rows={5}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(true);
              }}
              placeholder="Fix the login redirect loop in src/auth.ts and add a test for it"
              className={`${field} resize-y`}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-muted">Title <span className="font-normal text-faint">(optional)</span></span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to the prompt's first line" className={field} />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-muted">Folder</span>
            <input
              value={cwd}
              onChange={(e) => {
                setCwd(e.target.value);
                setError(null);
              }}
              placeholder="~/dev/my-project"
              className={`${field} font-mono`}
            />
          </label>

          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-muted">CLI</span>
              <div className="flex rounded-md border border-line-strong p-0.5">
                {BACKENDS.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setBackend(b.id)}
                    className={`rounded px-3 py-1 text-[12.5px] ${backend === b.id ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink"}`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-muted">Permissions</span>
              <select
                value={permissionMode}
                onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
                className="rounded-md border border-line-strong bg-canvas px-2.5 py-[7px] text-[12.5px] text-ink outline-none focus:border-accent"
              >
                <option value="default">Ask me</option>
                <option value="acceptEdits">Accept file edits</option>
                <option value="auto">Auto (classifier decides)</option>
              </select>
            </label>
          </div>

          {error && <p className="text-[12.5px] text-danger">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button
            onClick={() => void submit(false)}
            disabled={busy}
            className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-ink hover:bg-sunken disabled:opacity-50"
          >
            Add to backlog
          </button>
          <button
            onClick={() => void submit(true)}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            Start now
          </button>
        </div>
      </div>
    </div>
  );
}
