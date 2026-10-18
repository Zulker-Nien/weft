"use client";

import { useEffect, useState } from "react";
import { LEAGUES } from "@/lib/game";
import { profileUrl, zoneOf, type LeagueRow, type LeagueView } from "@/lib/league";
import Tip from "./Tip";

// The Loom's League tab: your league this week (lib/league-sync.ts via /api/league), best first, with each
// builder's week (XP, shipped, streak, badges earned since Monday) and a link to their weft.zip/@username.

function Ladder({ tier }: { tier: number | null }) {
  return (
    <div className="flex items-end gap-1.5">
      {LEAGUES.map((name, i) => {
        const here = i === tier;
        const open = tier !== null && i <= tier;
        return (
          <div
            key={name}
            className={`flex flex-1 items-end justify-center rounded-t-md border border-b-0 pb-1.5 text-[11.5px] ${
              here ? "border-accent bg-accent-soft font-semibold text-accent" : open ? "border-line bg-sunken text-ink" : "border-dashed border-line bg-sunken text-muted"
            }`}
            style={{ height: 34 + i * 12 }}
          >
            {open ? name : `🔒 ${name}`}
          </div>
        );
      })}
    </div>
  );
}

function openProfile(url: string) {
  if (window.threadboard?.openExternal) window.threadboard.openExternal(url);
  else window.open(url, "_blank", "noreferrer");
}

function Row({ row, size, tier }: { row: LeagueRow; size: number; tier: number }) {
  const zone = zoneOf(row, size, tier);
  const url = profileUrl(row.username);
  const name = <span className="truncate font-semibold text-ink">{row.name}{row.isMe && <span className="font-normal text-muted"> (you)</span>}</span>;
  return (
    <div className={`grid grid-cols-[28px_32px_1fr_auto_64px] items-center gap-2.5 border-t border-line px-3 py-2 first:border-t-0 ${row.isMe ? "bg-accent-soft/40" : ""}`}>
      <span className={`text-center text-[13px] font-bold tabular-nums ${zone === "up" ? "text-green-500" : zone === "down" ? "text-red-500" : "text-muted"}`}>
        {row.rank}
      </span>
      {row.avatar ? <img src={row.avatar} alt="" className="h-8 w-8 rounded-full" /> : <span className="h-8 w-8 rounded-full bg-sunken" />}
      <div className="flex min-w-0 flex-col">
        {url ? (
          <button onClick={() => openProfile(url)} className="flex min-w-0 text-left hover:underline">
            {name}
          </button>
        ) : (
          name
        )}
        <span className="truncate text-[11px] text-muted">
          Level {row.level} · {row.shipped} shipped{row.streak > 0 ? ` · 🔥 ${row.streak}` : ""}
          {url && <span> · @{row.username}</span>}
        </span>
      </div>
      <div className="flex max-w-[180px] flex-wrap justify-end gap-0.5">
        {row.badges.map((b) => (
          <Tip key={b.name} text={b.name}>
            <span className="text-[15px]">{b.icon}</span>
          </Tip>
        ))}
      </div>
      <span className="text-right text-[13px] font-semibold tabular-nums text-ink">{row.xp.toLocaleString()}</span>
    </div>
  );
}

export default function LeagueTab({ weekXp }: { weekXp: number }) {
  const [view, setView] = useState<LeagueView | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/league")
      .then((r) => r.json() as Promise<{ league?: LeagueView; error?: string }>)
      .then((d) => live && setView(d.league ?? { state: "error", error: d.error ?? "Couldn't read your league." }))
      .catch(() => live && setView({ state: "error", error: "Couldn't reach Weft's server." }));
    return () => {
      live = false;
    };
  }, []);

  if (!view) return <p className="text-[12.5px] text-muted">Reading your league…</p>;
  if (view.state !== "ready") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-muted">
          {view.state === "signed-out"
            ? "Sign in to Weft (top bar) to join a league: about 30 builders ranked by the XP they earn Monday to Sunday. The top 7 move up and the bottom 5 move down. Only your week's XP, cards shipped, streak, level and badges are shared, never prompts or code."
            : view.error}
        </p>
        <Ladder tier={null} />
        <p className="text-[12.5px] text-muted">This week: {weekXp.toLocaleString()} XP</p>
      </div>
    );
  }
  const size = view.rows.length;
  return (
    <div className="flex flex-col gap-3">
      <Ladder tier={view.tier} />
      <div className="flex items-baseline justify-between text-[12px] text-muted">
        <span>
          <span className="font-semibold text-ink">{view.league} League</span> · week of {view.week} · {size} {size === 1 ? "builder" : "builders"}
        </span>
        <span>
          {view.up > 0 && <span className="text-green-500">top {view.up} move up</span>}
          {view.up > 0 && view.down > 0 && " · "}
          {view.down > 0 && <span className="text-red-500">bottom {view.down} move down</span>}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-line">
        <div className="grid grid-cols-[28px_32px_1fr_auto_64px] gap-2.5 bg-sunken px-3 py-1.5 text-[10.5px] uppercase tracking-wide text-muted">
          <span className="text-center">#</span>
          <span />
          <span>Builder</span>
          <span className="text-right">Badges this week</span>
          <span className="text-right">XP</span>
        </div>
        {view.rows.map((row) => (
          <Row key={row.userId} row={row} size={size} tier={view.tier} />
        ))}
      </div>
    </div>
  );
}
