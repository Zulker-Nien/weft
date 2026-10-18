"use client";

// Which team Settings → Team is managing: every team you're in with your role in each, the current one ticked,
// and "+ New team" beside it. Shown even with one team, so the page always says where you are.
import { useState } from "react";
import type { TeamClientActions, TeamOrg, TeamRole } from "@/lib/team-types";
import { orgLabel } from "@/lib/team-view";
import { NewTeamForm } from "./NewTeamForm";

export function TeamSwitcher({
  orgs,
  current,
  roleLabels,
  actions,
  onSwitch,
}: {
  orgs: TeamOrg[];
  current: string;
  roleLabels: Record<TeamRole, string>;
  actions: TeamClientActions;
  onSwitch: (slug: string) => void;
}) {
  const [creating, setCreating] = useState(false);

  if (creating) {
    return (
      <NewTeamForm
        actions={actions}
        onCancel={() => setCreating(false)}
        onCreated={(slug) => {
          setCreating(false);
          onSwitch(slug);
        }}
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Switch team"
        value={current}
        onChange={(e) => onSwitch(e.target.value)}
        className="max-w-[200px] rounded-md border border-line-strong bg-canvas px-2 py-1 text-[12.5px] text-ink outline-none focus:border-accent"
      >
        {orgs.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.slug === current ? "✓ " : ""}
            {orgLabel(o, roleLabels)}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setCreating(true)}
        className="rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken"
      >
        + New team
      </button>
    </div>
  );
}
