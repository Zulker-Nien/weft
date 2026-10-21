"use client";

import { useState } from "react";
import type { WelcomePreview } from "@/lib/welcome-client";
import type { WelcomeProject } from "@/lib/welcome-preview";

// The welcome's projects screen (components/WelcomeDialog.tsx draws the frame and the buttons).

function ProjectRow({ project, on, toggle }: { project: WelcomeProject; on: boolean; toggle: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-1.5 text-[12.5px] last:border-b-0">
      <input type="checkbox" checked={on} onChange={toggle} />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-ink">{project.name}</span> <span className="text-muted">{project.where}</span>
      </span>
      <span className="text-[11.5px] tabular-nums text-muted">
        {project.sessions.toLocaleString()} session{project.sessions === 1 ? "" : "s"}
      </span>
    </label>
  );
}

// The projects whose sessions become cards. Scratch, worktree and temp folders sit folded, unticked.
// The history switch rides along at the bottom (it used to be a screen of its own), with the profile it makes.
export function ProjectsStep({
  projects,
  ticked,
  toggle,
  history,
}: {
  projects: WelcomeProject[];
  ticked: ReadonlySet<string>;
  toggle: (cwd: string) => void;
  history?: { on: boolean; set: (on: boolean) => void; preview: WelcomePreview };
}) {
  const [showScratch, setShowScratch] = useState(false);
  const real = projects.filter((p) => !p.scratch);
  const scratch = projects.filter((p) => p.scratch);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[18px] font-semibold text-ink">Bring in your projects</h2>
        <p className="text-[12.5px] text-muted">
          {real.length} project{real.length === 1 ? "" : "s"} with Claude Code sessions. Each ticked one comes onto your board, its sessions as cards.
        </p>
      </div>
      <div className="max-h-[300px] overflow-auto rounded-lg border border-line">
        {real.map((p) => (
          <ProjectRow key={p.cwd} project={p} on={ticked.has(p.cwd)} toggle={() => toggle(p.cwd)} />
        ))}
        {scratch.length > 0 && (
          <button type="button" onClick={() => setShowScratch((s) => !s)} className="w-full bg-sunken px-3 py-1.5 text-left text-[12px] text-muted hover:text-ink">
            {showScratch ? "▾" : "▸"} {scratch.length} scratch, temp and worktree folder{scratch.length === 1 ? "" : "s"} left out
          </button>
        )}
        {showScratch && scratch.map((p) => <ProjectRow key={p.cwd} project={p} on={ticked.has(p.cwd)} toggle={() => toggle(p.cwd)} />)}
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11.5px] text-muted">
        <span className="rounded-full bg-sunken px-2 py-0.5">Last 3 days → Review</span>
        <span className="rounded-full bg-sunken px-2 py-0.5">Older → Done</span>
        <span className="rounded-full bg-sunken px-2 py-0.5">Nothing is uploaded</span>
      </div>
      {history && <HistorySwitch {...history} />}
    </div>
  );
}

// Count your Claude Code history on your Wefter Profile, showing the level and class it makes.
function HistorySwitch({ on, set, preview }: { on: boolean; set: (on: boolean) => void; preview: WelcomePreview }) {
  const { profile } = preview;
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line px-3 py-2 text-[12.5px]">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span className="min-w-0 flex-1">
        <span className="text-ink">Count my past sessions on my Wefter Profile</span>
        <span className="block text-[11.5px] text-muted">
          {on ? `Starts you at Level ${profile.level.level} · ${profile.className}, from ${profile.sessions.toLocaleString()} sessions.` : "Start your profile from zero."} It stays on this Mac.
        </span>
      </span>
      <span className="text-[18px]" aria-hidden>
        {on ? "🔥" : "🌱"}
      </span>
    </label>
  );
}
