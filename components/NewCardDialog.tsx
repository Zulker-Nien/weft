"use client";

import { useEffect, useRef, useState } from "react";
import { api, type NewCardInput } from "@/lib/client";
import { blanksIn } from "@/lib/library-view";
import type { Backend, Effort, LibraryItem, PermissionMode } from "@/lib/types";
import Composer, { type ComposerHandle } from "./Composer";
import Icon from "./Icon";
import ModePicker from "./ModePicker";
import { alsoHereLine, busyInFolder } from "@/lib/overlap";
import type { Card } from "@/lib/types";
import RepoPicker from "./RepoPicker";
import { useEscape } from "@/lib/use-escape";

const LAST_CWD = "threadboard.cwd";
const LAST_BACKEND = "threadboard.backend";
const LAST_MODEL = "weft.model";
const LAST_EFFORT = "weft.effort";
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

const MODELS = [
  { id: "claude-fable-5-1", label: "Fable 5.1" },
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
];

const DEFAULT_MODEL = "claude-opus-5-5";

// "" leaves it to the model's own default. A new thread uses the last card's choice, High at first.
const DEFAULT_EFFORT: Effort = "high";
const EFFORTS: { id: Effort | ""; label: string }[] = [
  { id: "", label: "Default effort" },
  { id: "low", label: "Low effort" },
  { id: "medium", label: "Medium effort" },
  { id: "high", label: "High effort" },
  { id: "xhigh", label: "Extra high effort" },
  { id: "max", label: "Max effort" },
];

export default function NewCardDialog({
  cards = [],
  home,
  defaultCwd,
  recentCwd,
  recipe,
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
  // Run from a library recipe: its prompt, with {blanks} to fill in, instead of the draft.
  recipe?: LibraryItem;
  onClose: () => void;
  onCreate: (input: NewCardInput) => Promise<void>;
}) {
  const [initial] = useState(() => (recipe ? (recipe.prompt ?? "") : (remembered(DRAFT) ?? "")));
  // The recipe's blanks still in the prompt; it can't start until they're filled in.
  const [blanks, setBlanks] = useState(() => blanksIn(recipe?.prompt ?? ""));
  const [cwd, setCwd] = useState(() => {
    // Home isn't a project, so only fall back to it when nothing better is known.
    const last = remembered(LAST_CWD);
    return defaultCwd ?? (last && last !== home ? last : undefined) ?? recentCwd ?? last ?? home;
  });
  const [backend, setBackend] = useState<Backend>(() => (remembered(LAST_BACKEND) as Backend | null) ?? "claude");
  const [model, setModel] = useState(() => {
    const saved = remembered(LAST_MODEL);
    return MODELS.some((m) => m.id === saved) ? saved! : DEFAULT_MODEL;
  });
  const [effort, setEffort] = useState<Effort | "">(() => {
    const saved = remembered(LAST_EFFORT);
    return EFFORTS.find((e) => e.id === saved)?.id ?? DEFAULT_EFFORT;
  });
  // Starts in Settings' default mode, unless you pick one before it loads.
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("auto");
  const pickedMode = useRef(false);
  // Cards get no worktree, so a busy card in this folder would share its working tree.
  const alsoHere = busyInFolder(cards, cwd);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEscape(true, onClose);

  useEffect(() => () => clearTimeout(draftTimer.current), []);

  useEffect(() => {
    api.settings().then(
      (s) => {
        if (!pickedMode.current) setPermissionMode(s.defaultPermissionMode);
      },
      () => {},
    );
  }, []);

  function saveDraft(markdown: string) {
    setError(null);
    // A recipe's prompt isn't your draft: the draft you had stays for next time.
    if (recipe) return setBlanks(blanksIn(markdown));
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
    if (recipe && blanksIn(prompt).length) {
      setError(`Fill in ${blanksIn(prompt).map((b) => `{${b}}`).join(", ")} first.`);
      composer.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await onCreate({ prompt, cwd, backend, permissionMode, model: backend === "claude" ? model : undefined, effort: (backend === "claude" && effort) || undefined, recipeId: recipe?.id, start });
      clearTimeout(draftTimer.current);
      if (!recipe) remember(DRAFT, null);
      remember(LAST_CWD, cwd);
      remember(LAST_BACKEND, backend);
      remember(LAST_MODEL, model);
      // Kept even when it's "", so picking Default effort sticks too.
      remember(LAST_EFFORT, effort);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  // The prompt is saved as a draft as it's typed, so Escape or a click outside keeps it.
  return (
    <aside className="flex w-[44%] min-w-[380px] shrink-0 flex-col bg-panel last:flex-1">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="min-w-0 truncate text-[15px] font-medium text-ink" title={recipe?.description}>
            {recipe ? `↻ ${recipe.title}` : "New thread"}
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink">
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
            placeholder="What should this thread do? Paste screenshots or videos right where they belong, or hit the mic and talk."
            sizeClass="h-full min-h-[180px]"
            className="flex-1"
          />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pt-3">
          <RepoPicker value={cwd} home={home} onChange={chooseFolder} />

          {backend === "claude" && (
            <label className="relative flex items-center gap-1.5 rounded-md border border-line-strong py-1.5 pl-2.5 pr-1.5 text-[12px] text-ink">
              <span className="sr-only">Model</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="cursor-pointer appearance-none bg-transparent pr-4 font-medium outline-none"
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" size={12} className="pointer-events-none absolute right-1.5" />
            </label>
          )}

          {backend === "claude" && (
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
              <Icon name="chevronDown" size={12} className="pointer-events-none absolute right-1.5" />
            </label>
          )}

          <ModePicker
            value={permissionMode}
            onChange={(mode) => {
              pickedMode.current = true;
              setPermissionMode(mode);
            }}
          />
        </div>

        <div className="flex shrink-0 items-center gap-3 px-5 pb-4 pt-3">
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
          <p className="min-w-0 flex-1 truncate text-[12px]">
            {error ? (
              <span className="text-danger">{error}</span>
            ) : blanks.length > 0 ? (
              <span className="font-medium text-accent">Fill in {blanks.map((b) => `{${b}}`).join(" ")} in the prompt</span>
            ) : alsoHere.length > 0 ? (
              <span
                className="flex min-w-0 items-center gap-1.5 text-warn"
                title={`These threads share this folder's working tree:\n${alsoHere.map((c) => c.title).join("\n")}`}
              >
                <Icon name="alert" size={12} className="shrink-0" />
                <span className="truncate">{alsoHereLine(alsoHere)}</span>
              </span>
            ) : (
              <span className="text-faint">
                <kbd className="font-sans">⌘↵</kbd> starts it · the title comes from the prompt
              </span>
            )}
          </p>
          <button
            onClick={() => void submit(false)}
            disabled={busy || blanks.length > 0}
            className="shrink-0 rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-ink hover:bg-sunken disabled:opacity-50"
          >
            Add to backlog
          </button>
          <button
            onClick={() => void submit(true)}
            disabled={busy || blanks.length > 0}
            className="shrink-0 rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            Start now
          </button>
        </div>
    </aside>
  );
}
