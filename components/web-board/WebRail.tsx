"use client";

// The weft.zip board's left edge, the desktop's 38px rail (components/LibraryRail.tsx): ★ filters the board to starred
// cards, and under a divider the workspace's pages (Board, lit, then Team and Billing) where the Mac keeps its drawers.
import { CreditCard, LayoutGrid, Users } from "lucide-react";
import RailIconButton from "../RailIconButton";

const LINK = "grid size-7 place-items-center rounded-md";

export function WebRail({ orgSlug, starred, starredCount, onStarred }: { orgSlug: string; starred: boolean; starredCount: number; onStarred: () => void }) {
  const pages = [
    { id: "board", label: "Board", Icon: LayoutGrid },
    { id: "team", label: "Team", Icon: Users },
    { id: "billing", label: "Billing", Icon: CreditCard },
  ] as const;
  return (
    <nav className="hidden w-[38px] shrink-0 flex-col items-center gap-1 border-r border-line bg-panel pt-2 sm:flex" aria-label="Rail">
      <RailIconButton
        icon="★"
        label="Starred"
        open={starred}
        title={starred ? "Show every card" : `Show starred cards (${starredCount})`}
        onClick={onStarred}
      />
      <span className="my-1 h-px w-5 bg-line" aria-hidden />
      {pages.map(({ id, label, Icon }) => (
        <a
          key={id}
          href={`/${orgSlug}/${id}`}
          title={label}
          aria-current={id === "board" ? "page" : undefined}
          className={`${LINK} ${id === "board" ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"}`}
        >
          <Icon size={15} aria-hidden />
          <span className="sr-only">{label}</span>
        </a>
      ))}
    </nav>
  );
}
