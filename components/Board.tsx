"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { showBacklog, subscribeBoardPrefs } from "@/lib/board-prefs";
import { api, mergeThread, type BrowserState, type MenuAction, type NewCardInput } from "@/lib/client";
import { worktreeParent } from "@/lib/format";
import { busyHere } from "@/lib/overlap";
import { startPileReview } from "@/lib/pile-review";
import { planResets } from "@/lib/schedule";
import { COLUMNS, COPILOT_ID, type BoardEvent, type Card, type Column, type LoginView, type Project, type ThreadItem } from "@/lib/types";
import { useShortcutHint, useShortcutListener, useShortcuts } from "@/lib/hotkeys";
import { playChime, preloadChimes } from "@/lib/chimes";
import {
  cardChangeEffects,
  groupByColumn,
  hitPlanLimit,
  latestLimits,
  SORTERS,
  stepThrough,
  summarizeProjects,
  topMatches,
  type SortKey,
} from "@/lib/board-view";
import { useBoardEvents } from "@/lib/use-events";
import { useRestart } from "@/lib/use-restart";
import { useDesktopBridge } from "@/lib/use-desktop-bridge";
import { useStartupCheck } from "@/lib/use-startup-check";
import { readViewPrefs, writeViewPrefs } from "@/lib/view-prefs";
import { useNow } from "@/lib/use-now";
import { useToast } from "@/lib/use-toast";
import { useCopilotCard } from "@/lib/use-copilot-card";
import { resumeActions } from "@/lib/resume-actions";
import { archivedMessage, neighborAfter } from "@/lib/archive";
import { useEscape } from "@/lib/use-escape";
import { announceAccountChange } from "@/lib/use-account";
import ColumnPlaceholder from "./ColumnPlaceholder";
import CrashGuard from "./CrashGuard";
import { guarded } from "./guarded";
import type { PaletteItem } from "./CommandPalette";
import { boardPaletteItems, promptItems } from "./board-palette";
import { boardShortcuts } from "./board-shortcuts";
import { addSecret } from "@/lib/use-vault";
import { parseSecretAsk } from "@/lib/vault-view";
import { addWebhookAsk } from "@/lib/use-webhooks";
import { parseWebhookAsk } from "@/lib/webhooks-view";
import Icon from "./Icon";
import ColumnHeader from "./ColumnHeader";
import { filterCards, isFiltering, railPinned, addTag, toggleTag, type RailFilter, type RailPanel } from "@/lib/rail-view";
import { TagColors } from "./TagPill";
import { useTagCatalog } from "./use-tag-catalog";
import { useBoardMenus } from "./use-board-menus";
import { useSwitchAll } from "./switch-all-button";
import ProjectBar, { folderName } from "./ProjectBar";
import FilterBox from "./FilterBox";
import { NO_DRAG } from "@/lib/no-drag";

// Each loads in its own CrashGuard (components/guarded.tsx), so a piece a thread left half-written, even one that
// fails as its module loads, breaks only its own spot on the board.
const AccountButton = guarded(() => import("./AccountButton"), { inline: true, what: "account button" });
const CopilotButton = guarded(() => import("./CopilotButton"), { inline: true, what: "copilot button" });
const RestartChip = guarded(() => import("./RestartChip"), { inline: true, what: "restart chip" });
const BrowserPane = guarded(() => import("./BrowserPane"), { what: "browser pane", className: "m-3 w-[360px] self-start" });
const CardView = guarded(() => import("./CardView"), { what: "card" });
const SideRail = guarded(() => import("./LibraryRail"), { what: "rail", className: "m-3 w-[220px] self-start" });
const TagsDialog = guarded(() => import("./TagsDialog"), { what: "tags dialog", className: "fixed left-4 top-16 z-50" });
const HeaderBadges = guarded(() => import("./HeaderBadges"), { inline: true, what: "header badges" });
const BoardFooter = guarded(() => import("./BoardFooter"), { what: "footer" });
const ModifierHint = guarded(() => import("./ModifierHint"), { inline: true, what: "modifier hint", className: "fixed bottom-2 right-2 z-50" });
const LoginDialog = guarded(() => import("./LoginDialog"), { what: "login dialog", className: "fixed left-4 top-16 z-50" });
const NewCardDialog = guarded(() => import("./NewCardDialog"), { what: "New thread dialog", className: "m-3 w-[360px] self-start" });
const SettingsDialog = guarded(() => import("./SettingsDialog"), { what: "settings", className: "fixed left-4 top-16 z-50" });
const ShortcutsDialog = guarded(() => import("./ShortcutsDialog"), { what: "shortcuts sheet", className: "fixed left-4 top-16 z-50" });
const TerminalDrawer = guarded(() => import("./TerminalDrawer"), { what: "terminal", className: "m-3" });
const ThreadPanel = guarded(() => import("./ThreadPanel"), { what: "thread", className: "m-3 w-[360px] self-start" });
const CommandPalette = guarded(() => import("./CommandPalette"), { what: "command palette", className: "fixed left-4 top-16 z-50" });

// The browser pane's page beside the New thread dialog (not a card's).
const NEW_THREAD_PANE = "new-thread";

const CLOSED_BROWSER: BrowserState = {
  visible: false,
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  zoom: 100,
};

// Cards shown per column until "Show more"; picking up Claude Code sessions can put hundreds in one.
const COLUMN_LIMIT = 40;
// Cards the filter box lists under itself while typing.
const FILTER_MATCHES = 5;

function without(set: ReadonlySet<string>, id: string) {
  const next = new Set(set);
  next.delete(id);
  return next;
}

function lastFolder() {
  try {
    return localStorage.getItem("threadboard.cwd");
  } catch {
    return null;
  }
}

// A desktop notification when a card changes column while the app isn't focused.
function announce(card: Card, onClick: () => void) {
  const message =
    card.column === "needs_you"
      ? `${card.title} needs you`
      : card.column === "review"
        ? `${card.title} is ready for review`
        : card.column === "done"
          ? `${card.title} is done`
          : null;
  if (!message || typeof Notification === "undefined" || document.hasFocus()) return;
  if (Notification.permission !== "granted") {
    if (Notification.permission === "default") void Notification.requestPermission();
    return;
  }
  const notification = new Notification(message, { body: card.pending?.title ?? card.lastLine ?? "" });
  notification.onclick = () => {
    window.focus();
    onClick();
  };
}

export default function Board() {
  const [cards, setCards] = useState<Card[]>([]);
  const [home, setHome] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The card you opened last: still outlined after you close it, so you can find your place on the board.
  const [lastOpenId, setLastOpenId] = useState<string | null>(null);
  const { toast, setToast, notify } = useToast();
  // Restart when idle (lib/restart-when-idle.ts): the header chip and the palette command.
  const restartView = useRestart();
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [streaming, setStreaming] = useState("");
  const [showNew, setShowNew] = useState(false);
  // The folder "New Thread in This Folder" asked for; otherwise the dialog picks.
  const [newCwd, setNewCwd] = useState<string | undefined>();
  // The left rail's open drawer (🏷 tags, 🔐 and the tools under it).
  const [libraryOpen, setLibraryOpen] = useState<RailPanel | null>(null);
  // ★ and 🏷 on the rail narrow the board to starred cards, a tag, or both.
  const [railFilter, setRailFilter] = useState<RailFilter>({});
  // The card opened from Rename…, so its title opens ready to edit.
  const [renameId, setRenameId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<Column | null>(null);
  const [webBrowserOpen, setWebBrowserOpen] = useState(false);
  const [browserWidth, setBrowserWidth] = useState(560);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(240);
  const { copilot, update: updateCopilot, load: loadCopilot } = useCopilotCard();
  const copilotNeedsYou = copilot?.column === "needs_you";
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<string | null>(null);
  // Worktree folder -> its main repo, from the server; the bar shows each worktree's cards under that repo.
  const [roots, setRoots] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  // The cards the last archive filed away, for Z and the toast's Undo.
  const [lastArchived, setLastArchived] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [login, setLogin] = useState<LoginView | null>(null);
  // Columns showing all their cards, for the project and filter they were expanded under.
  const [expanded, setExpanded] = useState<{ view: string; columns: Column[] }>({ view: "", columns: [] });
  // Each card's last known column, to notice when one moves.
  const columns = useRef(new Map<string, Column>());
  // Each card's last known error, to chime when a new one appears.
  const errors = useRef(new Map<string, string | undefined>());
  // Moves you made, by card: where to and when, so their chime is skipped.
  const ownMoves = useRef(new Map<string, { column: Column; at: number }>());
  const selectedRef = useRef<string | null>(null);
  // Cards that moved (with a chime) while you weren't looking; highlighted until you open them.
  const [unseen, setUnseen] = useState<ReadonlySet<string>>(new Set());
  // Folders the server has already resolved into roots.
  const resolvedFolders = useRef(new Set<string>());
  const now = useNow();
  const { desktop, mac, browser } = useDesktopBridge(CLOSED_BROWSER, selectedId, cards);
  useStartupCheck(loaded, setToast);
  const onMenu = useRef<(action: MenuAction, payload?: string) => void>(() => {});

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  // Decode the chime files now, so the first card that moves isn't late to sound.
  useEffect(() => preloadChimes(), []);

  // merge keeps live items that arrived during the fetch; without it (after a reconnect, when what's
  // shown may be stale) the snapshot replaces the thread.
  const loadThread = useCallback((id: string, { merge = false }: { merge?: boolean } = {}) => {
    api
      .thread(id)
      .then((data) => {
        if (selectedRef.current === id) setThread((prev) => (merge ? mergeThread(data.items, prev) : data.items));
      })
      .catch(() => {});
  }, []);

  const rootOf = useCallback((cwd: string) => roots[cwd] ?? worktreeParent(cwd) ?? cwd, [roots]);

  // A card or project in a folder the server hasn't seen yet fetches the roots again, in case it's a worktree.
  const resolveFolders = useCallback((folders: string[]) => {
    const fresh = folders.filter((f) => !resolvedFolders.current.has(f) && !worktreeParent(f));
    if (!fresh.length) return;
    for (const f of fresh) resolvedFolders.current.add(f);
    api
      .list()
      .then((data) => setRoots(data.roots))
      .catch(() => {});
  }, []);

  const select = useCallback(
    (id: string | null) => {
      // A card always opens full screen, with its browser beside the thread; closing it hides the browser.
      if (Boolean(id) !== Boolean(selectedRef.current)) {
        if (window.threadboard) window.threadboard.browser.setVisible(Boolean(id));
        else setWebBrowserOpen(Boolean(id));
      }
      selectedRef.current = id;
      setSelectedId(id);
      if (id) setLastOpenId(id);
      setRenameId(null);
      if (id) setUnseen((prev) => (prev.has(id) ? without(prev, id) : prev));
      setThread([]);
      setStreaming("");
      if (id) loadThread(id, { merge: true });
    },
    [loadThread],
  );

  // Live updates. The first open (and every reconnect) reloads everything, so nothing is missed.
  useBoardEvents(
    (event: BoardEvent) => {
      switch (event.type) {
        case "card":
          // The copilot is a thread too, but it has its own window and no project.
          if (event.card.role === "copilot") {
            updateCopilot(event.card);
            break;
          }
          {
            const { id, column, error } = event.card;
            const effects = cardChangeEffects({
              previous: columns.current.get(id),
              column,
              previousError: errors.current.get(id),
              error,
              own: ownMoves.current.get(id),
              now: Date.now(),
              open: selectedRef.current === id,
            });
            columns.current.set(id, column);
            errors.current.set(id, error);
            if (effects.moved) {
              announce(event.card, () => select(id));
              ownMoves.current.delete(id);
            }
            if (effects.chime) playChime(effects.chime);
            if (effects.markUnseen) setUnseen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
            if (effects.errorChime) playChime("error");
          }
          resolveFolders([event.card.cwd]);
          setCards((prev) => {
            const at = prev.findIndex((c) => c.id === event.card.id);
            if (at === -1) return [event.card, ...prev];
            const next = prev.slice();
            next[at] = event.card;
            return next;
          });
          break;
        case "card_deleted":
          setCards((prev) => prev.filter((c) => c.id !== event.id));
          setUnseen((prev) => (prev.has(event.id) ? without(prev, event.id) : prev));
          if (selectedRef.current === event.id) setSelectedId(null);
          break;
        case "thread":
          if (event.cardId !== selectedRef.current) break;
          setThread((prev) => {
            const next = event.truncate ? prev.slice(0, event.index) : prev.slice();
            next[event.index] = event.item;
            return next;
          });
          if (event.item.kind === "assistant" || event.item.kind === "result") setStreaming("");
          break;
        case "delta":
          if (event.cardId === selectedRef.current) setStreaming((text) => text + event.text);
          break;
        case "account":
          announceAccountChange();
          break;
        case "restart":
          restartView.apply(event.restart);
          if (event.restart.error) setToast(event.restart.error);
          break;
        case "projects":
          resolveFolders(event.projects.map((p) => p.path));
          setProjects(event.projects);
          break;
        case "login":
          setLogin(event.login.state === "cancelled" ? null : event.login);
          break;
      }
    },
    () => {
      api
        .list()
        .then((data) => {
          columns.current = new Map(data.cards.map((c) => [c.id, c.column]));
          errors.current = new Map(data.cards.map((c) => [c.id, c.error]));
          for (const c of data.cards) resolvedFolders.current.add(c.cwd);
          setCards(data.cards);
          setHome(data.home);
          setRoots(data.roots);
          setLoaded(true);
        })
        .catch(notify);
      api
        .settings()
        .then((settings) => {
          // The card list resolved the saved projects too.
          for (const p of settings.projects) resolvedFolders.current.add(p.path);
          setProjects(settings.projects);
        })
        .catch(() => {});
      const prefs = readViewPrefs();
      if (prefs.project !== undefined) setProject(prefs.project);
      if (prefs.sort && prefs.sort in SORTERS) setSort(prefs.sort);
      loadCopilot();
      restartView.reload();
      if (selectedRef.current) loadThread(selectedRef.current);
    },
  );

  // While the New thread dialog is up, the browser pane beside it shows the splash. Closing it goes back to
  // the open card's browser (a card just started is open by then), or the pane as it was.
  useEffect(() => {
    const bridge = window.threadboard;
    if (!showNew || !bridge) return;
    const before = bridge.browser.getState();
    const page = api.newThreadPage();
    const shown = page.then(({ url }) => bridge.browser.open(url, NEW_THREAD_PANE)).catch(() => {});
    return () => {
      void Promise.all([before, shown]).then(([state]) => {
        bridge.browser.setActive(selectedRef.current);
        if (!selectedRef.current) bridge.browser.setVisible(state.visible);
      });
    };
  }, [showNew]);

  // The menu, dock, tray, and shortcuts reach the board through onMenu, which always sees the latest state.
  useEffect(() => {
    onMenu.current = (action, payload) => {
      switch (action) {
        case "new-thread":
          openNew();
          break;
        case "settings":
          setShowSettings(true);
          break;
        case "open-card": {
          const card = cards.find((c) => c.id === payload);
          if (card) openCard(card);
          else if (payload) select(payload);
          break;
        }
        case "find":
          focusFilter();
          break;
        case "terminal":
          toggleTerminal();
          break;
        // A thread asked for a key the vault doesn't have: the 🔐 Add form with its name filled in.
        case "add-secret":
          addSecret(setLibraryOpen, parseSecretAsk(payload));
          break;
        // A thread added a webhook for you to register: the 🪝 drawer opens on its row.
        case "add-webhook":
          addWebhookAsk(setLibraryOpen, parseWebhookAsk(payload));
          break;
      }
    };
  });

  useEffect(() => window.threadboard?.onMenu((action, payload) => onMenu.current(action, payload)), []);

  const filtering = Boolean(project || query.trim() || isFiltering(railFilter));
  // Picking another project or changing the filter collapses the columns again.
  const view = `${project ?? ""}\n${query.trim()}\n${railFilter.starred ? "★" : ""}${railFilter.tag ?? ""}`;
  const expandedColumns = expanded.view === view ? expanded.columns : [];

  const byColumn = useMemo(
    () => groupByColumn(filterCards(cards, railFilter), { project, query, sort, showArchived }, rootOf),
    [cards, railFilter, project, query, sort, showArchived, rootOf],
  );
  const archivedCount = cards.filter((c) => c.archived && (!project || rootOf(c.cwd) === project)).length;
  // The Done cards on screen that Shift+E and "Archive all" file away.
  const doneToArchive = (byColumn.get("done") ?? []).filter((c) => !c.archived && c.column === "done");
  const { resume, all: resumeAll } = resumeActions(byColumn.get("review") ?? [], notify);
  // Backlog hides unless Settings turns it on, but never hides cards waiting in it.
  const backlogOn = useSyncExternalStore(subscribeBoardPrefs, showBacklog, () => false);
  const visibleColumns = COLUMNS.filter(
    (c) => c.id !== "backlog" || backlogOn || cards.some((card) => card.column === "backlog" && !card.archived),
  );

  const projectSummaries = useMemo(() => summarizeProjects(projects, cards, rootOf), [projects, cards, rootOf]);

  // The 🔐 drawer's vaults: every project's on the board, so you can add secrets to any of them and copy
  // between them; its filter starts on the selected project.
  const railFolders = useMemo(() => {
    const paths = projects.map((p) => p.path);
    return project && !paths.includes(project) ? [project, ...paths] : paths;
  }, [project, projects]);

  // The copilot opens in the same window as any card, though it lives apart from `cards`.
  const selected = cards.find((c) => c.id === selectedId) ?? (copilot?.id === selectedId ? copilot : null);
  // An open card, or the New thread form, fills a framed window with the browser pane beside it.
  const framed = Boolean(selected) || showNew;
  // The most recent card's stats (and folder/backend), so the footer has a model/folder to show
  // when no card is open. Account-wide limits live in here too.
  const latest = latestLimits(cards);
  const footerStats = selected ? selected.stats : latest;
  const footerCwd = selected ? selected.cwd : latest?.cwd;
  const footerBackend = selected ? selected.backend : latest?.backend;
  // Each folder has its own shell; with All projects showing, the latest card's folder.
  const terminalCwd = selected?.cwd ?? project ?? latest?.cwd ?? home;
  const browserOpen = desktop ? browser.visible : webBrowserOpen;
  // Archived cards are hidden from the board, so the header doesn't count them either.
  const waiting = cards.filter((c) => c.column === "needs_you" && !c.archived).length;
  const running = cards.filter((c) => c.column === "running" && !c.archived).length;
  // "Switch all" only shows once a thread hit its plan limit.
  const limitHit = hitPlanLimit(cards);

  // Shortcuts that act on the board stand down while a dialog or the project menu is up.
  const boardKeys = !(showNew || showSettings || showHelp || showPalette || Boolean(login) || menuOpen);

  function filterHasFocus() {
    return document.activeElement === document.querySelector('input[placeholder="Filter cards"]');
  }

  function openPalette(initial: string) {
    setPaletteQuery(initial.trim());
    setShowPalette(true);
  }

  function focusFilter() {
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Filter cards"]');
    input?.focus();
    input?.select();
  }

  // Moves keyboard focus between the rendered cards. dx steps to the next column that has cards, dy up or
  // down the current one, and "first" and "last" jump within it. With nothing focused it starts at the
  // open card, or else the first card on the board.
  function moveFocus(move: { dx?: number; dy?: number; edge?: "first" | "last" }) {
    const inColumn = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-column="${id}"] [data-card-id]`)];
    const current =
      document.activeElement?.closest<HTMLElement>("[data-card-id]") ??
      (selectedId ? inColumn(selected?.column ?? "").find((el) => el.dataset.cardId === selectedId) : undefined);
    const ids = visibleColumns.map((c) => c.id);
    const column = current?.closest<HTMLElement>("[data-column]")?.dataset.column as Column | undefined;
    if (!current || !column) {
      const first = ids.map(inColumn).find((list) => list.length > 0);
      first?.[0]?.focus();
      return;
    }
    const list = inColumn(column);
    const row = list.indexOf(current);
    if (move.dx) {
      for (let i = ids.indexOf(column) + move.dx; i >= 0 && i < ids.length; i += move.dx) {
        const next = inColumn(ids[i] ?? "");
        if (next.length) {
          next[Math.min(row, next.length - 1)]?.focus();
          return;
        }
      }
      return;
    }
    const target = move.edge === "first" ? 0 : move.edge === "last" ? list.length - 1 : row + (move.dy ?? 0);
    list[Math.max(0, Math.min(list.length - 1, target))]?.focus();
  }

  // Steps through the project filter: "All projects", then each project in the bar's order.
  function stepProject(by: number) {
    chooseProject(stepThrough([null, ...projectSummaries.map((p) => p.path)], project, by));
  }

  function stepSort() {
    chooseSort(stepThrough(Object.keys(SORTERS) as SortKey[], sort, 1));
  }

  function jumpToNeedsYou() {
    const list = [...document.querySelectorAll<HTMLElement>('[data-column="needs_you"] [data-card-id]')];
    if (!list.length) return false;
    const at = list.findIndex((el) => el.contains(document.activeElement));
    list[(at + 1) % list.length]?.focus();
  }

  // Enter only opens a card that has focus itself, so it still presses a button inside one.
  function openFocused(e: KeyboardEvent) {
    const el = document.activeElement?.closest<HTMLElement>("[data-card-id]");
    const card = cards.find((c) => c.id === el?.dataset.cardId);
    if (!card || (e.key === "Enter" && e.target !== el)) return false;
    openCard(card);
  }

  // Everything the command palette offers: the board's actions, the projects, and every card.
  function paletteItems(): PaletteItem[] {
    return boardPaletteItems(
      { cards, selected, projectSummaries, home, doneToArchive, lastArchived, archivedCount, showArchived, rootOf, restartArmed: !!restartView.restart?.armed },
      {
        openNew: () => openNew(),
        focusFilter,
        toggleCopilot,
        toggleBrowser,
        toggleTerminal,
        openSettings: () => setShowSettings(true),
        openHelp: () => setShowHelp(true),
        addSecret: () => addSecret(setLibraryOpen),
        jumpToNeedsYou: () => void jumpToNeedsYou(),
        archiveCards,
        unarchive,
        toggleShowArchived: () => setShowArchived((v) => !v),
        chooseSort,
        focusReply: () => document.querySelector<HTMLElement>('aside [contenteditable="true"], aside textarea')?.focus(),
        closeThread: () => select(null),
        toggleArchive,
        stop: (id) => void api.stop(id).catch(notify),
        move,
        chooseProject,
        openCard,
        toast: setToast,
      },
    );
  }

  // The prompts the user wrote that match a query, as palette items that open their card.
  async function findPrompts(query: string): Promise<PaletteItem[]> {
    const { hits } = await api.searchPrompts(query);
    return promptItems(hits, cards, rootOf, openCard);
  }

  useShortcuts(
    boardShortcuts({
      showNew,
      showSettings,
      showHelp,
      showPalette,
      login,
      query,
      boardKeys,
      doneToArchive,
      lastArchived,
      setShowPalette,
      setShowHelp,
      setShowSettings,
      setLibraryOpen,
      openPalette,
      filterHasFocus,
      openNew: () => openNew(),
      focusFilter,
      toggleCopilot,
      toggleBrowser,
      toggleTerminal,
      moveFocus,
      openFocused,
      jumpToNeedsYou,
      stepProject,
      stepSort,
      archiveTarget,
      toggleArchive,
      archiveCards,
      unarchive,
    }),
  );
  useShortcutListener();
  const hint = useShortcutHint();

  function chooseProject(path: string | null) {
    // A new project starts clean: close the open thread and its browser.
    if (path !== project) {
      select(null);
      if (window.threadboard) window.threadboard.browser.setVisible(false);
      else setWebBrowserOpen(false);
    }
    setProject(path);
    writeViewPrefs({ project: path, sort });
    // Have a CLI ready in that folder for the next new thread.
    if (path) api.warm({ cwd: path }).catch(() => {});
  }

  function chooseSort(next: SortKey) {
    setSort(next);
    writeViewPrefs({ project, sort: next });
  }

  function openNew(folder?: string) {
    setNewCwd(folder);
    setShowNew(true);
    const cwd = folder ?? project ?? lastFolder();
    if (cwd) api.warm({ cwd }).catch(() => {});
  }

  // Archiving closes the thread; unarchiving leaves it open.
  function toggleArchive(card: Card) {
    if (card.archived) api.archive(card.id, false).catch(notify);
    else archiveCards([card]);
  }

  // Archives the cards and offers an Undo (the toast's button, or Z). Keyboard focus moves to the next card
  // in the column, so E, E, E clears a column.
  function archiveCards(list: Card[], message = archivedMessage(list.map((c) => c.title))) {
    if (!list.length) return;
    const ids = list.map((c) => c.id);
    const column = document.querySelector(`[data-card-id="${ids[0]}"]`)?.closest<HTMLElement>("[data-column]");
    const shown = [...(column?.querySelectorAll<HTMLElement>("[data-card-id]") ?? [])];
    const next = neighborAfter(shown.map((el) => el.dataset.cardId ?? ""), ids);
    if (selectedRef.current && ids.includes(selectedRef.current)) select(null);
    shown.find((el) => el.dataset.cardId === next)?.focus();
    Promise.all(ids.map((id) => api.archive(id, true))).catch(notify);
    setLastArchived(ids);
    setToast(message, { label: "Undo", run: () => unarchive(ids) });
  }

  function unarchive(ids: string[]) {
    setLastArchived([]);
    setToast(null);
    Promise.all(ids.map((id) => api.archive(id, false))).catch(notify);
  }

  // The card the archive keys act on: the one with keyboard focus, else the open thread.
  function archiveTarget(): Card | undefined {
    const el = document.activeElement?.closest<HTMLElement>("[data-card-id]");
    return cards.find((c) => c.id === el?.dataset.cardId) ?? selected ?? undefined;
  }

  // A card dropped on a tag in the 🏷 drawer gets that tag.
  function tagCard(cardId: string, tag: string) {
    const card = cards.find((c) => c.id === cardId);
    const next = card && addTag(card.tags, tag);
    if (next) api.mark(cardId, { tags: next }).catch(notify);
  }

  function openCard(card: Card) {
    select(card.id);
    // Start its CLI now so a reply doesn't wait.
    if (!card.warm && card.column !== "done") api.warm({ cardId: card.id }).catch(() => {});
  }

  function toggleBrowser() {
    // An open card and its browser are one window: they open and close together.
    if (selectedRef.current) return;
    if (window.threadboard) window.threadboard.browser.setVisible(!browser.visible);
    else setWebBrowserOpen((open) => !open);
  }

  // Escape closes the newest open layer. The board's own panels sit under any dialog or menu, even one
  // opened before them. The thread closes even mid-reply: ReplyBox keeps the draft for next time. A card
  // and its browser are one window, so they close together.
  useEscape(Boolean(selectedId), () => select(null), { panel: true });
  useEscape(browserOpen && !selectedId && !showNew, toggleBrowser, { panel: true });
  // Registered last, so an open rail drawer closes before the browser does.
  useEscape(Boolean(libraryOpen) && !selectedId && !showNew && !railPinned(), () => setLibraryOpen(null), { panel: true });

  function toggleTerminal() {
    setTerminalOpen((open) => !open);
  }

  // The ✨ button, c and the palette open the copilot as a card, like a click on its card in the column;
  // only the global hotkey (⌃⌥Space) still opens its own window, for when the board is hidden.
  function toggleCopilot() {
    if (selectedRef.current === COPILOT_ID) select(null);
    else if (copilot) openCard(copilot);
    else select(COPILOT_ID);
  }

  // Moves a card for you, remembering it so the move doesn't chime.
  function move(id: string, column: Column) {
    ownMoves.current.set(id, { column, at: Date.now() });
    api.move(id, column).catch(notify);
  }


  function drop(column: Column, e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/plain");
    const card = cards.find((c) => c.id === id);
    if (card && card.column !== column) move(id, column);
  }

  const tagCatalog = useTagCatalog(cards, notify);
  const { onCardMenu, onColumnMenu, toggleStar, tagging, editTags, saveTags, closeTags } = useBoardMenus({
    doneShown: byColumn.get("done") ?? [],
    archivedCount,
    showArchived,
    openCard,
    renameCard: (card) => {
      openCard(card);
      setRenameId(card.id);
    },
    move,
    toggleArchive,
    archive: archiveCards,
    remove: (card) => {
      if (selectedRef.current === card.id) select(null);
      api.remove(card.id).catch(notify);
    },
    openNew,
    toggleArchived: () => setShowArchived((v) => !v),
    toast: setToast,
    notify,
  });

  // "Switch all to <other CLI>" on the Running and Needs you columns. Idle cards flip right
  // away; busy ones come back in `pending` and the modal polls for them.
  const { switchColumn: switchAll, dialog: switchAllDialog } = useSwitchAll({
    byColumn,
    setToast: (msg) => setToast(msg),
    notify,
  });

  // The header badges' cards: the quality badge's fixes and the pile counter's commit walk-through.
  // Resolves to the new card's id, so a caller can open it.
  async function improveQuality(cwd: string, prompt: string, title: string): Promise<string | undefined> {
    const { card } = await api.create({ title, prompt, cwd, backend: "claude", start: true });
    return card.id;
  }

  // "Review all" on the Review column: the same commit walk-through card the pile counter starts, opened
  // right away (in a busy Review column it got lost among the others).
  async function reviewAll() {
    const cwd = selected?.cwd ?? project ?? latest?.cwd;
    if (!cwd) return;
    try {
      await startPileReview(cwd, improveQuality, select);
    } catch (err) {
      notify(err);
    }
  }

  // A new card lands in its column without opening, so after ⌘↵ the keyboard is back on the board
  // (opening it moved focus where Escape couldn't reach).
  async function create(input: NewCardInput) {
    await api.create(input);
  }

  return (
    <TagColors.Provider value={tagCatalog.colors}>
    <div className="flex h-screen flex-col">
      <header
        className={`flex shrink-0 items-center gap-3 border-b border-line bg-panel ${mac ? "app-drag mac-title-bar pr-4" : "px-4 py-2.5"}`}
      >
        <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
          <img src="/logo.svg" alt="" width={18} height={18} />
          Weft
        </h1>
        <span className="text-[12px] text-muted">
          {running} running
          {waiting > 0 && <span className="text-warn"> · {waiting} need{waiting === 1 ? "s" : ""} you</span>}
        </span>
        <RestartChip restart={restartView.restart} notify={notify} />
        <HeaderBadges cwd={selected?.cwd ?? project ?? latest?.cwd} cards={cards} start={improveQuality} notify={notify} toast={setToast} />
        <div className="flex-1" />
        <CopilotButton open={selectedId === COPILOT_ID} needsYou={copilotNeedsYou} title={hint("copilot", "Copilot")} onClick={toggleCopilot} />
        <button
          onClick={toggleBrowser}
          title={hint("browser", "Browser")}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] ${browserOpen ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-ink hover:bg-sunken"}`}
        >
          <Icon name="globe" size={14} /> Browser
        </button>
        <button
          onClick={toggleTerminal}
          title={hint("terminal", "Terminal")}
          aria-label="Terminal"
          className={`rounded-md border p-1.5 ${terminalOpen ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-muted hover:bg-sunken hover:text-ink"}`}
        >
          <Icon name="terminal" size={15} />
        </button>
        <button
          onClick={() => setShowSettings(true)}
          title={hint("settings", "Settings")}
          aria-label="Settings"
          className="rounded-md border border-line-strong p-1.5 text-muted hover:bg-sunken hover:text-ink"
        >
          <Icon name="sliders" size={15} />
        </button>
        <button
          onClick={() => openNew()}
          title={hint("new-thread", "New thread")}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-on-accent hover:opacity-90"
        >
          <Icon name="plus" size={14} /> New thread
          <kbd className="ml-0.5 rounded border border-current/30 px-1 font-mono text-[10.5px] leading-[15px] opacity-70">N</kbd>
        </button>
        <AccountButton onOpenSettings={() => setShowSettings(true)} />
      </header>

      <CrashGuard what="project bar" className="mx-3 mt-2">
      <ProjectBar
        projects={projectSummaries}
        total={cards.length}
        selected={project}
        onSelect={chooseProject}
        filter={
          <>
          <RailFilterChip filter={railFilter} onClear={setRailFilter} />
          <FilterBox
            query={query}
            onQuery={setQuery}
            matches={query.trim() ? topMatches(byColumn, FILTER_MATCHES) : []}
            onOpen={openCard}
            onSearchAll={() => openPalette(query)}
          />
          </>
        }
        sort={sort}
        onSort={chooseSort}
        home={home}
        onMenuOpenChange={setMenuOpen}
      />
      </CrashGuard>

      <div className="flex min-h-0 flex-1">
        <SideRail
          open={libraryOpen}
          onOpen={setLibraryOpen}
          project={project}
          folders={railFolders}
          cards={cards}
          filter={railFilter}
          onFilter={setRailFilter}
          onStarCard={(id) => {
            const card = cards.find((c) => c.id === id);
            if (card && !card.starred) toggleStar(card);
          }}
          onTagCard={tagCard}
          catalog={tagCatalog}
          onOpenUrl={showPage}
          onOpenCard={openCard}
          onStartCard={improveQuality}
          notify={notify}
        />
        <main
          className="flex min-w-0 flex-1 gap-3 overflow-x-auto p-3"
          onDoubleClick={(e) => {
            // Empty board space (between or inside columns, not on a card or control) opens New thread.
            if (!(e.target as HTMLElement).closest("[data-card-id], button, a, input, textarea, [contenteditable]")) openNew();
          }}
        >
          {visibleColumns.map((column) => {
            const list = byColumn.get(column.id) ?? [];
            const shown = expandedColumns.includes(column.id) ? list : list.slice(0, COLUMN_LIMIT);
            // The copilot runs the whole board, so a project filter keeps it; a search hides it.
            const pilot = loaded && copilot?.column === column.id && !query.trim() && !isFiltering(railFilter) ? copilot : null;
            const count = list.length + (pilot ? 1 : 0);
            return (
              <section
                key={column.id}
                data-column={column.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(column.id);
                }}
                onDragLeave={() => setDragOver((c) => (c === column.id ? null : c))}
                onDrop={(e) => drop(column.id, e)}
                onContextMenu={(e) => void onColumnMenu(column.id, e)}
                className={`flex w-[264px] min-w-[220px] shrink-0 flex-col rounded-xl border ${dragOver === column.id ? "border-accent bg-accent-soft" : "border-transparent bg-sunken"}`}
              >
                <ColumnHeader
                  column={column}
                  count={loaded ? count : null}
                  needsYou={column.id === "needs_you" && count > 0}
                  archivedCount={archivedCount}
                  showArchived={showArchived}
                  onToggleArchived={() => setShowArchived((v) => !v)}
                  toArchive={doneToArchive.length}
                  archiveTip={hint("archive-done", `Archive all ${doneToArchive.length}`)}
                  onArchiveAll={() => archiveCards(doneToArchive)}
                  resumeAll={column.id === "review" ? resumeAll : undefined}
                  onSwitchAll={limitHit && (column.id === "running" || column.id === "needs_you") ? () => switchAll(column.id) : undefined}
                  onReviewAll={column.id === "review" ? reviewAll : undefined}
                />
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {pilot && (
                      <CardView
                        guardName={pilot.title}
                        card={pilot}
                        now={now}
                        selected={pilot.id === selectedId}
                        onOpen={toggleCopilot}
                        onAnswer={(allow) => void api.answer(pilot.id, allow, undefined, pilot.pending?.id).catch(notify)}
                        onStop={() => void api.stop(pilot.id).catch(notify)}
                      />
                  )}
                  {shown.map((card) => (
                    <CardView
                      key={card.id}
                      guardName={card.title}
                      card={card}
                      now={now}
                      selected={card.id === selectedId}
                      lastOpen={card.id === lastOpenId}
                      unseen={unseen.has(card.id)}
                      alsoHere={busyHere(cards, card)}
                      onOpen={() => openCard(card)}
                      onAnswer={(allow) => void api.answer(card.id, allow, undefined, card.pending?.id).catch(notify)}
                      onStop={() => void api.stop(card.id).catch(notify)}
                      onResume={(how) => resume(card.id, how)}
                      onContextMenu={(e) => void onCardMenu(card, e)}
                      onStar={() => toggleStar(card)}
                      onTag={(tag) => setRailFilter((f) => toggleTag(f, tag))}
                    />
                  ))}
                  {shown.length < list.length && (
                    <button
                      onClick={() => setExpanded({ view, columns: [...expandedColumns, column.id] })}
                      className="rounded-lg px-2 py-1.5 text-center text-[12px] text-muted hover:bg-card hover:text-ink"
                    >
                      Show {list.length - shown.length} more
                    </button>
                  )}
                  <ColumnPlaceholder column={column.id} loaded={loaded} empty={count === 0} filtering={filtering} />
                  {column.id === "backlog" && (
                    <button
                      onClick={() => openNew()}
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-muted hover:bg-card hover:text-ink"
                    >
                      <Icon name="plus" size={13} /> Add a thread
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </main>

        {framed && <div style={NO_DRAG} className="fixed inset-0 z-30 bg-black/40" onClick={() => (showNew ? setShowNew(false) : select(null))} aria-hidden="true" />}
        <div style={framed ? { ...NO_DRAG, bottom: terminalOpen ? terminalHeight + 16 : undefined } : undefined} className={framed ? "fixed inset-4 z-40 flex overflow-hidden rounded-xl border border-line-strong bg-panel shadow-2xl" : "contents"}>
        {showNew ? (
          <NewCardDialog cards={cards} home={home} defaultCwd={newCwd ?? project ?? undefined} recentCwd={[...cards].sort((a, b) => b.updatedAt - a.updatedAt).find((c) => c.cwd !== home)?.cwd} onClose={() => setShowNew(false)} onCreate={create} />
        ) : selected && (
          <ThreadPanel
            key={selected.id}
            guardName={selected.title}
            card={selected}
            onStar={() => toggleStar(selected)}
            onTags={() => editTags(selected)}
            resets={planResets(cards)}
            items={thread}
            streaming={streaming}
            onSend={async (text) => {
              // /done wraps the thread up on its own, so the thread closes as it's sent.
              // A failed send shows on the board, since the thread isn't there to show it.
              if (/^\/(weft:)?done(-quick)?(\s|$)/.test(text.trim())) {
                select(null);
                api.send(selected.id, text).catch(notify);
                return;
              }
              await api.send(selected.id, text);
            }}
            onAnswer={(allow, answers) => void api.answer(selected.id, allow, answers, selected.pending?.id).catch(notify)}
            onRelease={() => void api.release(selected.id).catch(notify)}
            onArchive={() => toggleArchive(selected)}
            onDelete={() => {
              select(null);
              api.remove(selected.id).catch(notify);
            }}
            onClose={browserOpen ? undefined : () => select(null)}
            onRename={(title) => void api.rename(selected.id, title).catch(notify)}
            onMode={(mode) => void api.setMode(selected.id, mode).catch(notify)}
            onNewChat={() => void api.resetCopilot().then(() => select(selected.id)).catch(notify)}
            editTitle={renameId === selected.id}
          />
        )}

        {browserOpen && (
          <BrowserPane
            desktop={desktop}
            state={browser}
            obscured={showSettings || showPalette || showHelp || Boolean(login) || menuOpen}
            width={browserWidth}
            onWidth={setBrowserWidth}
            onClose={showNew ? () => setShowNew(false) : selected ? () => select(null) : toggleBrowser}
            expanded={framed}
          />
        )}
        </div>
      </div>

      <BoardFooter stats={footerStats} cwd={footerCwd} backend={footerBackend} onHelp={() => setShowHelp(true)} />
      {/* After the footer so an open card can stop just above it; z-40 keeps it over the card's backdrop. */}
      {terminalOpen && (
        <div style={NO_DRAG} className="relative z-40">
          <TerminalDrawer key={terminalCwd} cwd={terminalCwd} height={terminalHeight} onHeight={setTerminalHeight} onClose={toggleTerminal} />
        </div>
      )}

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showHelp && <ShortcutsDialog onClose={() => setShowHelp(false)} />}
      {tagging && <TagsDialog card={tagging} all={tagCatalog.tags.map((t) => ({ tag: t.name, count: t.count }))} onChange={saveTags} onClose={closeTags} />}
      <ModifierHint />
      {showPalette && <CommandPalette initialQuery={paletteQuery} items={paletteItems()} findPrompts={findPrompts} currentProject={project ? { path: project, name: folderName(project) } : null} onClose={() => setShowPalette(false)} />}
      {login && <LoginDialog login={login} onClose={() => setLogin(null)} />}
      {switchAllDialog}

      {toast && (
        <div
          className={`fixed bottom-4 left-4 z-50 flex max-w-md items-start gap-2 rounded-lg border bg-panel px-3.5 py-2.5 text-[13px] text-ink shadow-lg ${toast.action ? "border-line" : "border-danger/30"}`}
        >
          {toast.action ? (
            <Icon name="archive" size={15} className="mt-0.5 text-muted" />
          ) : (
            <Icon name="alert" size={15} className="mt-0.5 text-danger" />
          )}
          <span className="flex-1">{toast.text}</span>
          {toast.action && (
            <button onClick={toast.action.run} className="font-medium text-accent hover:underline">
              {toast.action.label}
            </button>
          )}
          <button onClick={() => setToast(null)} aria-label="Dismiss" className="text-muted hover:text-ink">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
    </div>
    </TagColors.Provider>
  );
}

// The rail's ★ and tag filter, shown beside the filter box so it's clear why cards are missing: one click clears each.
function RailFilterChip({ filter, onClear }: { filter: RailFilter; onClear: (filter: RailFilter) => void }) {
  if (!isFiltering(filter)) return null;
  const chip = "flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent hover:opacity-80";
  return (
    <>
      {filter.starred && (
        <button onClick={() => onClear({ ...filter, starred: undefined })} title="Show every card, not just starred ones" className={chip}>
          ★ starred <Icon name="x" size={10} />
        </button>
      )}
      {filter.tag && (
        <button onClick={() => onClear({ ...filter, tag: undefined })} title={`Show every card, not just #${filter.tag}`} className={`${chip} max-w-[140px]`}>
          <span className="truncate">#{filter.tag}</span> <Icon name="x" size={10} />
        </button>
      )}
    </>
  );
}

// In the board's own browser (no card open), or a new tab outside the desktop app.
function showPage(url: string) {
  if (window.threadboard) void window.threadboard.browser.open(url, "board");
  else window.open(url, "_blank");
}

