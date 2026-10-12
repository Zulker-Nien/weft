"use client";

import { useState } from "react";
import { SCENES, THEMES, type Theme, savedTheme, sceneUrl, setTheme } from "@/lib/theme";
import Icon, { type IconName } from "./Icon";

const THEME_ICONS: Record<(typeof THEMES)[number]["id"], IconName> = { system: "monitor", light: "sun", dark: "moon" };

// Settings' Appearance: System, Light or Dark, then a tile per scene. Every pick applies right away.
export default function AppearancePicker() {
  // Only mounts in the browser, so the cookie is there to read.
  const [theme, setChoice] = useState<Theme>(savedTheme);
  const choose = (t: Theme) => {
    setTheme(t);
    setChoice(t);
  };

  return (
    <div role="radiogroup" aria-label="Appearance" className="flex flex-col gap-2">
      <div className="flex w-fit gap-0.5 rounded-md border border-line-strong p-0.5">
        {THEMES.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={theme === t.id}
            onClick={() => choose(t.id)}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[12.5px] ${theme === t.id ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"}`}
          >
            <Icon name={THEME_ICONS[t.id]} size={13} />
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {SCENES.map((s) => (
          <button
            key={s.id}
            role="radio"
            aria-checked={theme === s.id}
            onClick={() => choose(s.id)}
            style={{ backgroundImage: `url(${sceneUrl(s.id)})` }}
            className={`relative flex aspect-[4/3] items-end overflow-hidden rounded-md bg-sunken bg-cover bg-[center_70%] p-1.5 text-left outline-none ring-offset-1 ring-offset-panel focus-visible:ring-2 focus-visible:ring-accent ${theme === s.id ? "ring-2 ring-accent" : "opacity-85 hover:opacity-100"}`}
          >
            <span className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent to-60%" />
            <span className="relative text-[11.5px] font-medium leading-tight text-white">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
