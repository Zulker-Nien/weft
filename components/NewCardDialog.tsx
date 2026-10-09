"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { api, type NewCardInput } from "@/lib/client";
import type { Backend, CardStats, Effort, PermissionMode } from "@/lib/types";
import Composer, { type ComposerHandle } from "./Composer";
import Icon from "./Icon";
import RepoPicker from "./RepoPicker";
import StatusStrip from "./StatusStrip";
import { useEscape } from "@/lib/use-escape";

const LAST_CWD = "threadboard.cwd";
const LAST_BACKEND = "threadboard.backend";
const LAST_MODEL = "weft.model";
const LAST_EFFORT = "weft.effort";
// What you were writing, kept if the dialog closes before the thread is created.
const DRAFT = "weft.newThreadDraft";
const RECT = "weft.newThreadRect";

type Rect = { x: number; y: number; w: number; h: number };
const MIN_W = 480;
const MIN_H = 360;

// Keeps the dialog inside the window, shrinking it first if the window is smaller than its size.
function fit(r: Rect): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(r.w, Math.min(MIN_W, vw)), vw);
  const h = Math.min(Math.max(r.h, Math.min(MIN_H, vh)), vh);
  return { w, h, x: Math.min(Math.max(r.x, 0), vw - w), y: Math.min(Math.max(r.y, 0), vh - h) };
}

function initialRect(): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  try {
    const saved = JSON.parse(localStorage.getItem(RECT) ?? "null");
    if (saved && ["x", "y", "w", "h"].every((k) => Number.isFinite(saved[k]))) return fit(saved);
  } catch {}
  const w = Math.min(920, vw - 48);
  const h = Math.min(820, vh - 48);
  return fit({ w, h, x: (vw - w) / 2, y: (vh - h) / 2 });
}

// Edge/corner handles: which sides each one moves.
const HANDLES: { n: string; l?: 1; r?: 1; t?: 1; b?: 1; cls: string; cursor: string }[] = [
  { n: "t", t: 1, cls: "left-2 right-2 top-0 h-1.5", cursor: "ns-resize" },
  { n: "b", b: 1, cls: "bottom-0 left-2 right-2 h-1.5", cursor: "ns-resize" },
  { n: "l", l: 1, cls: "bottom-2 left-0 top-2 w-1.5", cursor: "ew-resize" },
  { n: "r", r: 1, cls: "bottom-2 right-0 top-2 w-1.5", cursor: "ew-resize" },
  { n: "tl", t: 1, l: 1, cls: "left-0 top-0 h-3 w-3", cursor: "nwse-resize" },
  { n: "tr", t: 1, r: 1, cls: "right-0 top-0 h-3 w-3", cursor: "nesw-resize" },
  { n: "bl", b: 1, l: 1, cls: "bottom-0 left-0 h-3 w-3", cursor: "nesw-resize" },
  { n: "br", b: 1, r: 1, cls: "bottom-0 right-0 h-3 w-3", cursor: "nwse-resize" },
];

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

// "" leaves it to the model's own default.
const EFFORTS: { id: Effort | ""; label: string }[] = [
  { id: "", label: "Default effort" },
  { id: "low", label: "Low effort" },
  { id: "medium", label: "Medium effort" },
  { id: "high", label: "High effort" },
  { id: "xhigh", label: "Extra high effort" },
  { id: "max", label: "Max effort" },
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
  recentCwd,
  limits,
  onClose,
  onCreate,
}: {
  home: string;
  // The selected project, if any; otherwise the last folder used.
  defaultCwd?: string;
  // Folder of the most recently active card outside home, used when nothing else is remembered.
  recentCwd?: string;
  // Plan rate limits from the most recent thread, since they apply to every thread.
  limits?: Pick<CardStats, "fiveHour" | "sevenDay">;
  onClose: () => void;
  onCreate: (input: NewCardInput) => Promise<void>;
}) {
  const [initial] = useState(() => remembered(DRAFT) ?? "");
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
    return EFFORTS.find((e) => e.id === saved)?.id ?? "";
  });
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("bypassPermissions");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Measured on first render: the dialog only mounts on a click, never during server render.
  const [rect, setRect] = useState<Rect | null>(initialRect);
  const rectRef = useRef<Rect | null>(rect);
  const composer = useRef<ComposerHandle>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // The prompt is saved as a draft as it's typed, so closing keeps it.
  useEscape(true, onClose);

  useEffect(() => () => clearTimeout(draftTimer.current), []);

  function place(r: Rect) {
    rectRef.current = r;
    setRect(r);
  }

  useEffect(() => {
    const onResize = () => rectRef.current && place(fit(rectRef.current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Drags the whole dialog (move) or the sides given (resize); the pointer is captured so it can leave the handle.
  function startDrag(e: ReactPointerEvent<HTMLElement>, sides: { l?: 1; r?: 1; t?: 1; b?: 1 } | "move") {
    const start = rectRef.current;
    if (!start || e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const move = (ev: PointerEvent) => {
      const dx = Math.min(Math.max(ev.clientX, 0), vw) - sx;
      const dy = Math.min(Math.max(ev.clientY, 0), vh) - sy;
      let { x, y, w, h } = start;
      if (sides === "move") {
        x = Math.min(Math.max(x + dx, 0), vw - w);
        y = Math.min(Math.max(y + dy, 0), vh - h);
      } else {
        if (sides.r) w = Math.min(Math.max(start.w + dx, MIN_W), vw - start.x);
        if (sides.b) h = Math.min(Math.max(start.h + dy, MIN_H), vh - start.y);
        if (sides.l) {
          x = Math.min(Math.max(start.x + dx, 0), start.x + start.w - MIN_W);
          w = start.x + start.w - x;
        }
        if (sides.t) {
          y = Math.min(Math.max(start.y + dy, 0), start.y + start.h - MIN_H);
          h = start.y + start.h - y;
        }
      }
      place(fit({ x, y, w, h }));
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      remember(RECT, JSON.stringify(rectRef.current));
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

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
      await onCreate({ prompt, cwd, backend, permissionMode, model: backend === "claude" ? model : undefined, effort: (backend === "claude" && effort) || undefined, start });
      clearTimeout(draftTimer.current);
      remember(DRAFT, null);
      remember(LAST_CWD, cwd);
      remember(LAST_BACKEND, backend);
      remember(LAST_MODEL, model);
      remember(LAST_EFFORT, effort || null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const mode = MODES.find((m) => m.id === permissionMode) ?? MODES[0];

  return (
    <div className="fixed inset-0 z-50 bg-black/40" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-labelledby="new-thread-title"
        onMouseDown={(e) => e.stopPropagation()}
        style={rect ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h } : { visibility: "hidden" }}
        className="absolute flex flex-col rounded-xl border border-line bg-panel shadow-2xl"
      >
        {HANDLES.map(({ n, cls, cursor, ...sides }) => (
          <div
            key={n}
            aria-hidden
            onPointerDown={(e) => startDrag(e, sides)}
            style={{ cursor, touchAction: "none" }}
            className={`absolute z-10 ${cls}`}
          />
        ))}
        <div
          onPointerDown={(e) => !(e.target as HTMLElement).closest("button") && startDrag(e, "move")}
          style={{ touchAction: "none" }}
          className="flex shrink-0 cursor-move select-none items-center justify-between px-5 pb-2 pt-4"
        >
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
            cwd={cwd}
            autoFocus
            initial={initial}
            onChange={saveDraft}
            onSubmit={() => void submit(true)}
            placeholder="What should this thread do? Paste screenshots or videos right where they belong, or hit the mic and talk."
            sizeClass="h-full min-h-[180px]"
            className="flex-1"
          />
          <StatusStrip cwd={cwd} stats={{ model: backend === "claude" ? model : undefined, ...limits }} className="mt-1.5 px-1" />
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
