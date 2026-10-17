"use client";

import { useRef, useState } from "react";
import { appFor, appGlyph, appMenu, type AppAction, type MiniApp } from "@/lib/mini-apps";
import { appActions, useMiniApps } from "@/lib/use-mini-apps";
import Tip from "./Tip";

// Mini apps on the left rail, below 🖥 Services (components/LibraryRail.tsx): one tile per page saved from the
// browser pane (components/SaveAppButton.tsx). A click opens the app in the board's pane; right-click renames,
// moves, copies or removes it. With no apps it draws nothing, not even its divider: the pane's Save as app button (the grid) is the way in.
export default function AppsRail({ current, onOpen, notify }: { current?: string; onOpen: (url: string) => void; notify: (err: unknown) => void }) {
  const apps = useMiniApps();
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!apps.length) return null;
  const active = appFor(apps, current);

  async function menu(app: MiniApp) {
    const shell = window.threadboard;
    if (!shell?.popupMenu) return;
    const picked = (await shell.popupMenu(appMenu(apps, app.id))) as AppAction | null;
    const at = apps.findIndex((a) => a.id === app.id);
    const run = (p: Promise<unknown>) => void p.catch(notify);
    if (picked === "open") onOpen(app.url);
    else if (picked === "rename") setRenaming(app.id);
    else if (picked === "up") run(appActions.move(app.id, at - 1));
    else if (picked === "down") run(appActions.move(app.id, at + 1));
    else if (picked === "copy") run(navigator.clipboard.writeText(app.url));
    else if (picked === "remove") run(appActions.remove(app.id));
  }

  return (
    <>
      <span className="my-1 h-px w-5 bg-line" aria-hidden />
      <div role="group" aria-label="Apps" className="flex flex-col items-center gap-1">
      {apps.map((app) => (
        <div key={app.id} className="relative">
          <Tip text={app.name}>
            <AppTile
              app={app}
              on={active?.id === app.id}
              onClick={() => onOpen(app.url)}
              onMenu={() => void menu(app)}
            />
          </Tip>
          {renaming === app.id && (
            <RenameApp
              app={app}
              onDone={(name) => {
                setRenaming(null);
                if (name && name !== app.name) void appActions.rename(app.id, name).catch(notify);
              }}
            />
          )}
        </div>
      ))}
      </div>
    </>
  );
}

function AppTile({ app, on, onClick, onMenu }: { app: MiniApp; on: boolean; onClick: () => void; onMenu: () => void }) {
  const glyph = appGlyph(app.name);
  return (
    <button
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu();
      }}
      aria-pressed={on}
      aria-label={app.name}
      style={glyph.emoji ? undefined : { background: `hsl(${glyph.hue} 55% 48%)` }}
      className={`grid size-7 place-items-center rounded-lg font-semibold ${glyph.emoji ? "bg-sunken text-[15px]" : "text-[12px] text-white"} ${on ? "outline-2 outline-offset-2 outline-accent" : "opacity-85 hover:opacity-100"}`}
    >
      <span aria-hidden>{glyph.text}</span>
    </button>
  );
}

// Rename in place, beside the tile: Enter or leaving the field keeps the name, Escape drops it.
function RenameApp({ app, onDone: done }: { app: MiniApp; onDone: (name: string | null) => void }) {
  const [name, setName] = useState(app.name);
  // Escape closes the field, and the field's blur as it goes must not save the name after all.
  const finished = useRef(false);
  const onDone = (next: string | null) => {
    if (finished.current) return;
    finished.current = true;
    done(next);
  };
  return (
    <input
      autoFocus
      value={name}
      aria-label={`Rename ${app.name}`}
      onChange={(e) => setName(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => onDone(name.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(name.trim());
        if (e.key === "Escape") {
          e.stopPropagation();
          onDone(null);
        }
      }}
      className="absolute left-full top-0 z-30 ml-2 w-44 rounded-md border border-accent bg-panel px-2 py-1 text-[12px] text-ink shadow-lg outline-none"
    />
  );
}
