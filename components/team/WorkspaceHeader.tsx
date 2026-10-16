"use client";

// The header strip at the top of every /[orgSlug]/* page on weft.zip: the
// workspace name, a switcher (only when the user belongs to more than one),
// the Team / Billing nav, the signed-in identity, and a Sign-out form that
// posts to /auth/sign-out (a same-origin cookie round trip — no JS needed).
//
// The switcher uses the same dropdown pattern as components/TagsDrawer and
// the existing AccountButton: a button that toggles aria-expanded, click-
// outside to dismiss, Escape to close, and the list of workspaces as <a>
// links so the browser does the navigation (and middle-click / right-click
// work). The current workspace is marked with aria-current="true".
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { TeamContext } from "@/lib/teams";

// What the header needs from the gate: everything but the service-role client, which must never reach the browser.
export type HeaderContext = Omit<TeamContext, "service">;

function userInitials(name: string | null, email: string | null): string {
  const seed = (name?.trim() || email?.split("@")[0] || "?").trim();
  return (seed[0] ?? "?").toUpperCase();
}

function userDisplayName(name: string | null, email: string | null): string {
  return name?.trim() || email || "Signed in";
}

function formatOrgLabel(org: TeamContext["orgs"][number]): string {
  return org.name.trim() || org.slug;
}

function useClickOutside(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose, ref]);
}

function WorkspaceSwitcher({ ctx }: { ctx: HeaderContext }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(open, () => setOpen(false), wrapRef);

  // No switcher when the user is in a single workspace: the toggle would be
  // a dead end. Sorted oldest-first (the team-actions contract on listUserOrgs),
  // so the dropdown's order matches the order they joined.
  if (ctx.orgs.length <= 1) {
    return <span className="wz-workspaceBrand">{formatOrgLabel(ctx.org)}</span>;
  }

  return (
    <div className="wz-workspaceSwitcher" ref={wrapRef}>
      <button
        type="button"
        className="wz-workspaceSwitcherButton"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Switch workspace (currently ${formatOrgLabel(ctx.org)})`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            e.currentTarget.focus();
          }
        }}
      >
        <span>{formatOrgLabel(ctx.org)}</span>
        <ChevronDown className="wz-workspaceSwitcherCaret" aria-hidden="true" />
      </button>
      {open ? (
        <div className="wz-workspaceSwitcherMenu" role="menu">
          {ctx.orgs.map((o) => {
            const isCurrent = o.id === ctx.org.id;
            return (
              <a
                key={o.id}
                role="menuitem"
                href={`/${o.slug}/team`}
                className="wz-workspaceSwitcherItem"
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => setOpen(false)}
              >
                {formatOrgLabel(o)}
                {isCurrent ? " ✓" : ""}
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceNav({ orgSlug, current }: { orgSlug: string; current: "team" | "billing" | "board" | "other" }) {
  // aria-current is on whichever page is rendering; the layout doesn't know
  // the segment, so the page passes it. The page is rendered at /[orgSlug]/*
  // — the nav stays the same for any future page that wants in.
  return (
    <nav className="wz-workspaceNav" aria-label="Workspace sections">
      <a
        className="wz-workspaceNavLink"
        href={`/${orgSlug}/board`}
        aria-current={current === "board" ? "page" : undefined}
      >
        Board
      </a>
      <a
        className="wz-workspaceNavLink"
        href={`/${orgSlug}/team`}
        aria-current={current === "team" ? "page" : undefined}
      >
        Team
      </a>
      <a
        className="wz-workspaceNavLink"
        href={`/${orgSlug}/billing`}
        aria-current={current === "billing" ? "page" : undefined}
      >
        Billing
      </a>
    </nav>
  );
}

function WorkspaceUser({ user }: { user: TeamContext["user"] }) {
  const display = userDisplayName(user.name, user.email);
  return (
    <span className="wz-workspaceUser" title={user.email ?? display}>
      <span className="wz-workspaceUserAvatar" aria-hidden="true">
        {user.avatar ? <img src={user.avatar} alt="" /> : userInitials(user.name, user.email)}
      </span>
      <span className="wz-workspaceUserName">{display}</span>
    </span>
  );
}

export function WorkspaceHeader({ ctx, current = "other" }: { ctx: HeaderContext; current?: "team" | "billing" | "board" | "other" }) {
  return (
    <header className="wz-workspaceHeader">
      <WorkspaceSwitcher ctx={ctx} />
      <WorkspaceNav orgSlug={ctx.org.slug} current={current} />
      <WorkspaceUser user={ctx.user} />
      {/* Plain POST form to /auth/sign-out: the route signs the visitor out
          and 303s to /login. No JS required. */}
      <form method="post" action="/auth/sign-out">
        <button type="submit" className="wz-workspaceSignOut">
          Sign out
        </button>
      </form>
    </header>
  );
}
