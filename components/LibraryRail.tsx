"use client";

import { useEffect, useState } from "react";
import { railPinned, setRailPinned, starredCount, toggleTag, type RailFilter, type RailPanel } from "@/lib/rail-view";
import type { Card } from "@/lib/types";
import { useVault } from "@/lib/use-vault";
import { filterVaults, railBadge } from "@/lib/vault-view";
import { useVercel } from "@/lib/use-vercel";
import { vercelTitle } from "@/lib/vercel-view";
import { useSupabase } from "@/lib/use-supabase";
import { supabaseTitle } from "@/lib/supabase-view";
import { useBlastcp } from "@/lib/use-blastcp";
import { blastcpTitle } from "@/lib/blastcp-view";
import { useGithub } from "@/lib/use-github";
import { githubTitle } from "@/lib/github-view";
import BlastcpDrawer from "./BlastcpDrawer";
import BlastcpLogo from "./BlastcpLogo";
import GithubDrawer from "./GithubDrawer";
import GithubLogo from "./GithubLogo";
import RailIconButton from "./RailIconButton";
import CrashGuard from "./CrashGuard";
import Icon from "./Icon";
import VaultButton from "./VaultButton";
import VaultDrawer from "./VaultDrawer";
import VercelDrawer from "./VercelDrawer";
import SupabaseDrawer from "./SupabaseDrawer";
import SupabaseLogo from "./SupabaseLogo";
import TagsDrawer from "./TagsDrawer";
import type { TagCatalog } from "./use-tag-catalog";

// The board's left edge: a 38px rail. ★ filters the board to starred cards (drop a card on it to star it),
// 🏷 opens the drawer of every tag (components/TagsDrawer.tsx; a tag there filters the board). The drawer
// slides over the board, or, pinned, pushes it over. Below a divider, 🔐 opens the same drawer on the secrets
// vault of the board's project(s), and ▲ on their Vercel links, Supabase's bolt on their Supabase projects,
// BlastCP's rocket on the BlastCP property each one posts as, and GitHub's mark on the gh sign-in and each
// one's issue sync.
// The drawers under the divider, each with its icon, title and label.
const TOOLS = { vault: ["🔐", "Secrets", "Secrets vault"], vercel: ["▲", "Vercel", "Vercel"], supabase: [<SupabaseLogo key="supabase" />, "Supabase", "Supabase"], blastcp: [<BlastcpLogo key="blastcp" />, "BlastCP", "BlastCP"], github: [<GithubLogo key="github" />, "GitHub", "GitHub"] } as const;
type Tool = keyof typeof TOOLS;
const isTool = (panel: RailPanel | null): panel is Tool => panel !== null && panel in TOOLS;

export default function SideRail({
  open,
  onOpen,
  project,
  folders,
  cards,
  filter,
  onFilter,
  onStarCard,
  onTagCard,
  catalog,
  onOpenUrl,
  notify,
}: {
  // Which drawer is open, if any.
  open: RailPanel | null;
  onOpen: (panel: RailPanel | null) => void;
  // The board's selected project folder, or null for all of them.
  project: string | null;
  // The folders whose vaults 🔐 shows: every project on the board (its filter starts on project).
  folders: string[];
  cards: Card[];
  // ★ and the tag the board is narrowed to (lib/rail-view.ts filterCards).
  filter: RailFilter;
  onFilter: (filter: RailFilter) => void;
  // A card dropped on ★, or on a tag in the drawer.
  onStarCard: (cardId: string) => void;
  onTagCard: (cardId: string, tag: string) => void;
  // Every tag with its colour and count, and the calls that change them (components/use-tag-catalog.ts).
  catalog: TagCatalog;
  // Shows a page (a deploy) in the board's browser pane.
  onOpenUrl: (url: string) => void;
  notify: (err: unknown) => void;
}) {
  const [pinned, setPinned] = useState(() => typeof window !== "undefined" && railPinned());
  // A card is being dragged somewhere on the board: ★ and 🏷 light up to show they take drops.
  const [cardDrag, setCardDrag] = useState(false);
  const vault = useVault(folders);
  const vaultBadge = railBadge(filterVaults(vault.overview?.vaults ?? [], project));
  const vercel = useVercel(folders, open === "vercel");
  const supabase = useSupabase(folders, open === "supabase");
  const blastcp = useBlastcp(folders, open === "blastcp");
  const github = useGithub(folders, open === "github");
  const starred = starredCount(cards);

  useEffect(() => {
    const start = (e: DragEvent) => setCardDrag(e.target instanceof Element && e.target.closest("[data-card-id]") !== null);
    const end = () => setCardDrag(false);
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, []);

  function pin(next: boolean) {
    setPinned(next);
    setRailPinned(next);
  }

  const onDropStar = (id: string) => {
    if (cards.some((c) => c.id === id)) onStarCard(id);
  };

  const drawerShell = ([icon, title, label]: readonly [React.ReactNode, string, string], body: React.ReactNode) => (
    <aside
      className={`flex w-[260px] shrink-0 flex-col border-r border-line bg-panel ${pinned ? "" : "absolute bottom-0 left-full top-0 z-20 shadow-[6px_0_18px_rgb(0_0_0/0.12)]"}`}
      aria-label={label}
    >
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <span className="text-[14px]" aria-hidden>
          {icon}
        </span>
        <h2 className="flex-1 text-[13px] font-semibold text-ink">{title}</h2>
        <button
          onClick={() => pin(!pinned)}
          title={pinned ? "Unpin: slide over the board" : "Pin: keep it open beside the board"}
          aria-pressed={pinned}
          className={`rounded px-1.5 py-0.5 text-[11px] ${pinned ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"}`}
        >
          {pinned ? "Pinned" : "Pin"}
        </button>
        <button onClick={() => onOpen(null)} aria-label="Close" className="rounded p-1 text-muted hover:bg-sunken hover:text-ink">
          <Icon name="x" size={13} />
        </button>
      </div>
      {/* A drawer that fails to draw keeps its header (Pin, ✕) and leaves the rail's icons working. */}
      <CrashGuard key={title} what="drawer" name={title} className="m-2">
        {body}
      </CrashGuard>
    </aside>
  );

  const toolBodies: Record<Tool, React.ReactNode> = {
    vault: <VaultDrawer {...vault} project={project} notify={notify} />,
    vercel: <VercelDrawer {...vercel} project={project} onOpenUrl={onOpenUrl} notify={notify} />,
    supabase: <SupabaseDrawer {...supabase} project={project} onOpenUrl={onOpenUrl} notify={notify} />,
    blastcp: <BlastcpDrawer {...blastcp} project={project} onOpenUrl={onOpenUrl} notify={notify} />,
    github: <GithubDrawer {...github} project={project} onOpenUrl={onOpenUrl} notify={notify} />,
  };
  const drawer = isTool(open)
    ? drawerShell(TOOLS[open], toolBodies[open])
    : open === "tags" &&
      drawerShell(
        ["🏷", "Tags", "Tags"],
        <TagsDrawer catalog={catalog} active={filter.tag} onFilter={(tag) => onFilter(toggleTag(filter, tag))} onDropCard={onTagCard} />,
      );
  const toggle = (panel: Tool) => () => onOpen(open === panel ? null : panel);

  return (
    <div className="relative flex shrink-0">
      <nav className="flex w-[38px] flex-col items-center gap-1 border-r border-line bg-panel pt-2" aria-label="Rail">
        <StarRailButton on={Boolean(filter.starred)} count={starred} cardDrag={cardDrag} onClick={() => onFilter({ ...filter, starred: !filter.starred })} onDropCard={onDropStar} />
        <TagsRailButton open={open === "tags"} tag={filter.tag} cardDrag={cardDrag} onOpen={(next) => onOpen(next ? "tags" : null)} />
        <span className="my-1 h-px w-5 bg-line" aria-hidden />
        <VaultButton open={open === "vault"} badge={vaultBadge} onClick={() => onOpen(open === "vault" ? null : "vault")} />
        <RailIconButton icon="▲" label="Vercel" open={open === "vercel"} title={vercelTitle(vercel.status, project)} onClick={toggle("vercel")} />
        <RailIconButton icon={<SupabaseLogo />} label="Supabase" open={open === "supabase"} title={supabaseTitle(supabase.status, project)} onClick={toggle("supabase")} />
        <RailIconButton icon={<BlastcpLogo />} label="BlastCP" open={open === "blastcp"} title={blastcpTitle(blastcp.status, project)} onClick={toggle("blastcp")} />
        <RailIconButton icon={<GithubLogo />} label="GitHub" open={open === "github"} title={githubTitle(github.status, project)} onClick={toggle("github")} />
      </nav>
      {cardDrag && !open && (
        <span className="pointer-events-none absolute left-full top-2 z-30 ml-1.5 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11.5px] text-canvas shadow-lg">
          Drop on ☆ to star it · 🏷 to tag it
        </span>
      )}
      {drawer}
    </div>
  );
}

// ★: filters the board to starred cards (again shows every card); its badge counts them. Drop a card on it to star it.
function StarRailButton({ on, count, cardDrag, onClick, onDropCard }: { on: boolean; count: number; cardDrag: boolean; onClick: () => void; onDropCard: (cardId: string) => void }) {
  const [dropOn, setDropOn] = useState(false);
  return (
    <button
      onClick={onClick}
      onDragOver={(e) => {
        e.preventDefault();
        setDropOn(true);
      }}
      onDragLeave={() => setDropOn(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropOn(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropCard(id);
      }}
      title={on ? "Showing starred cards · click to show every card" : "Show only starred cards · drop a card here to star it"}
      aria-pressed={on}
      className={`relative grid size-7 place-items-center rounded-md text-[15px] ${on || cardDrag ? "bg-accent-soft text-warn" : "text-muted hover:bg-sunken hover:text-warn"} ${dropOn ? "outline-2 outline-offset-2 outline-dashed outline-accent" : cardDrag ? "ring-1 ring-accent" : ""}`}
    >
      <span aria-hidden>{on ? "★" : "☆"}</span>
      <span className="sr-only">Starred cards</span>
      {count > 0 && <span className="absolute -right-1 -top-1 min-w-[14px] rounded-full bg-accent px-1 text-center text-[9px] font-semibold leading-[14px] text-on-accent">{count}</span>}
    </button>
  );
}

// 🏷: opens the tags drawer; a dot when the board is filtered to a tag. Dragging a card over it opens the
// drawer, so the card can drop on a tag.
function TagsRailButton({ open, tag, cardDrag, onOpen }: { open: boolean; tag?: string; cardDrag: boolean; onOpen: (open: boolean) => void }) {
  return (
    <button
      onClick={() => onOpen(!open)}
      onDragOver={(e) => {
        e.preventDefault();
        if (!open) onOpen(true);
      }}
      title={tag ? `Showing #${tag} · open the tags` : "Tags: filter the board, add, rename, recolour"}
      aria-pressed={open}
      className={`relative grid size-7 place-items-center rounded-md text-[14px] ${open || tag || cardDrag ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"} ${cardDrag ? "ring-1 ring-accent" : ""}`}
    >
      <span aria-hidden>🏷</span>
      <span className="sr-only">Tags</span>
      {tag && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-accent ring-2 ring-panel" aria-label={`Filtered to ${tag}`} />}
    </button>
  );
}
