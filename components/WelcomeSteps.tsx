"use client";

import { useState } from "react";
import type { WelcomePreview } from "@/lib/welcome-client";
import type { WelcomeProject } from "@/lib/welcome-preview";
import { Bar } from "./LoomCharts";

// The welcome's two screens (components/WelcomeDialog.tsx draws the frame and the buttons).

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-sunken px-2 py-2">
      <b className="text-[16px] tabular-nums text-ink">{value}</b>
      <span className="text-[11px] text-muted">{label}</span>
    </div>
  );
}

// Screen 1: the Wefter Profile your sessions make, and where every part of it came from.
export function ProfileStep({ preview }: { preview: WelcomePreview }) {
  const { profile, github } = preview;
  const name = github?.name ?? github?.login;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[18px] font-semibold text-ink">Here&apos;s your Wefter Profile</h2>
        <p className="text-[12.5px] text-muted">Weft built it from the work you&apos;ve already done with Claude Code.</p>
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-line bg-sunken p-3">
        {github?.avatarUrl ? (
          <img src={github.avatarUrl} alt="" width={52} height={52} className="shrink-0 rounded-full border border-line" />
        ) : (
          <span className="flex size-[52px] shrink-0 items-center justify-center rounded-full bg-accent text-[22px] font-semibold text-on-accent">
            {(name ?? "W").slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <b className="text-[16px] text-ink">{profile.className}</b>
          <span className="text-[12px] font-medium text-warn">
            Level {profile.level.level} · {profile.level.title}
          </span>
          {name && (
            <span className="truncate text-[12px] text-muted">
              {name}
              {github?.location ? ` · ${github.location}` : ""}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end">
          <b className="text-[22px] leading-none tabular-nums text-ink">{profile.projects}</b>
          <span className="text-[11px] text-muted">projects</span>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Stat value={profile.sessions.toLocaleString()} label="sessions" />
        <Stat value={profile.shipped.toLocaleString()} label="shipped" />
        <Stat value={`🔥 ${profile.bestStreak}`} label="best streak" />
        <Stat value={profile.xp.toLocaleString()} label="XP" />
      </div>
      <div className="flex flex-col gap-2">
        {profile.top.map((a) => (
          <Bar key={a.id} value={a.value} max={100} left={`${a.icon} ${a.label}`} right={a.value} />
        ))}
      </div>
      <div className="rounded-lg border border-dashed border-line px-3 py-2 text-[12px] text-muted">
        <b className="text-ink">Where this came from</b>
        <ul className="mt-1 list-disc pl-4">
          <li>
            {profile.sessions.toLocaleString()} Claude Code sessions in <code className="font-mono text-[11px]">~/.claude/projects</code>, read on this Mac
          </li>
          {github ? (
            <li>
              Your name{github.location ? " and location" : ""} from GitHub, through the <code className="font-mono text-[11px]">gh</code> CLI you&apos;re signed in to (@{github.login})
            </li>
          ) : (
            <li>
              Sign in to GitHub with <code className="font-mono text-[11px]">gh auth login</code> to add your name and picture
            </li>
          )}
          <li>It stays on this Mac. A league shows only your level, streak and shipped count, and only if you join one.</li>
        </ul>
      </div>
    </div>
  );
}

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

// Screen 2: the projects whose sessions become cards. Scratch, worktree and temp folders sit folded, unticked.
export function ProjectsStep({ projects, ticked, toggle }: { projects: WelcomeProject[]; ticked: ReadonlySet<string>; toggle: (cwd: string) => void }) {
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
    </div>
  );
}
