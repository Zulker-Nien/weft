"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { showBacklog, subscribeBoardPrefs } from "@/lib/board-prefs";
import { api, mergeThread, type BrowserState, type MenuAction, type NewCardInput } from "@/lib/client";
import { worktreeParent } from "@/lib/format";
import { busyHere } from "@/lib/overlap";
import { planResets } from "@/lib/schedule";
import { COLUMNS, type BoardEvent, type Card, type Column, type LibraryItem, type LibraryKind, type LoginView, type Project, type ThreadItem } from "@/lib/types";
import { useShortcutHint, useShortcutListener, useShortcuts } from "@/lib/hotkeys";
import { playChime, preloadChimes } from "@/lib/chimes";
import {
  cardChangeEffects,
  groupByColumn,
  latestLimits,
  SORTERS,
  stepThrough,
  summarizeProjects,
  type ProjectSummary,
  topMatches,
  type SortKey,
} from "@/lib/board-view";
import { useBoardEvents } from "@/lib/use-events";
import { useDesktopBridge } from "@/lib/use-desktop-bridge";
import { useNow } from "@/lib/use-now";
import { useToast } from "@/lib/use-toast";
import { archivedMessage, neighborAfter } from "@/lib/archive";
import { useEscape } from "@/lib/use-escape";
import BrowserPane from "./BrowserPane";
import CardView from "./CardView";
import CrashGuard from "./CrashGuard";
import CommandPalette, { type PaletteItem } from "./CommandPalette";
import { boardPaletteItems, promptItems } from "./board-palette";
import { boardShortcuts } from "./board-shortcuts";
import Icon from "./Icon";
import { leavesBoard, libraryPinned } from "@/lib/library-view";
import LibraryRail from "./LibraryRail";
import HeaderBadges from "./HeaderBadges";
import LoginDialog from "./LoginDialog";
import NewCardDialog from "./NewCardDialog";
import { useBoardMenus } from "./use-board-menus";
import ProjectBar, { folderName } from "./ProjectBar";
import FilterBox from "./FilterBox";
import SettingsDialog from "./SettingsDialog";
import ShortcutsDialog from "./ShortcutsDialog";
import BoardFooter from "./BoardFooter";
import ModifierHint from "./ModifierHint";
import TerminalDrawer from "./TerminalDrawer";
import ThreadPanel from "./ThreadPanel";
import { NO_DRAG } from "@/lib/no-drag";

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

const EMPTY_HINT: Record<Column, string> = {
  backlog: "New threads wait here until you start them",
  running: "Drag a backlog card here to start it",
  needs_you: "Cards land here when an agent asks for permission",
  review: "Cards land here when a turn finishes",
  done: "Drag reviewed threads here",
};

// Cards shown per column until "Show more"; picking up Claude Code sessions can put hundreds in one.
const COLUMN_LIMIT = 40;
// Cards the filter box lists under itself while typing.
const FILTER_MATCHES = 5;

// The selected project and sort order, remembered per browser.
const VIEW_PREFS = "threadboard.view";

function readPrefs(): { project?: string | null; sort?: SortKey } {
  try {
    return JSON.parse(localStorage.getItem(VIEW_PREFS) ?? "{}") as { project?: string | null; sort?: SortKey };
  } catch {
    return {};
  }
}

function without(set: ReadonlySet<string>, id: string) {
  const next = new Set(set);
  next.delete(id);
  return next;
}

function writePrefs(prefs: { project: string | null; sort: SortKey }) {
  try {
    localStorage.setItem(VIEW_PREFS, JSON.stringify(prefs));
  } catch {}
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
  const { toast, setToast, notify } = useToast();
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [streaming, setStreaming] = useState("");
  const [showNew, setShowNew] = useState(false);
  // The folder "New Thread in This Folder" asked for; otherwise the dialog picks.
  const [newCwd, setNewCwd] = useState<string | undefined>();
  // The library recipe the New thread dialog runs, if it was opened from one.
  const [recipe, setRecipe] = useState<LibraryItem | null>(null);
  // The library rail's open drawer; libraryVersion bumps on "library" events so it reloads.
  const [libraryOpen, setLibraryOpen] = useState<LibraryKind | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);
  // A library page to show in the pane once the open card has closed (closing it hides the pane).
  const libraryPage = useRef<string | null>(null);
  // The card opened from Rename…, so its title opens ready to edit.
  const [renameId, setRenameId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<Column | null>(null);
  const [webBrowserOpen, setWebBrowserOpen] = useState(false);
  const [browserWidth, setBrowserWidth] = useState(560);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(240);
  const [copilotNeedsYou, setCopilotNeedsYou] = useState(false);
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
  const copilotColumn = useRef<Column | null>(null);
  // Moves you made, by card: where to and when, so their chime is skipped.
  const ownMoves = useRef(new Map<string, { column: Column; at: number }>());
  const selectedRef = useRef<string | null>(null);
  // Cards that moved (with a chime) while you weren't looking; highlighted until you open them.
  const [unseen, setUnseen] = useState<ReadonlySet<string>>(new Set());
  // Folders the server has already resolved into roots.
  const resolvedFolders = useRef(new Set<string>());
  const now = useNow();
  const { desktop, mac, browser, copilotOpen } = useDesktopBridge(CLOSED_BROWSER, selectedId, cards);
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
          // The copilot is a thread too, but it has its own window.
          if (event.card.role === "copilot") {
            if (copilotColumn.current && copilotColumn.current !== "needs_you" && event.card.column === "needs_you") {
              playChime("needs_you");
            }
            copilotColumn.current = event.card.column;
            setCopilotNeedsYou(event.card.column === "needs_you");
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
            const next = prev.slice();
            next[event.index] = event.item;
            return next;
          });
          if (event.item.kind === "assistant" || event.item.kind === "result") setStreaming("");
          break;
        case "delta":
          if (event.cardId === selectedRef.current) setStreaming((text) => text + event.text);
          break;
        case "library":
          setLibraryVersion((v) => v + 1);
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
      const prefs = readPrefs();
      if (prefs.project !== undefined) setProject(prefs.project);
      if (prefs.sort && prefs.sort in SORTERS) setSort(prefs.sort);
      api
        .copilot()
        .then(({ card }) => {
          copilotColumn.current = card.column;
          setCopilotNeedsYou(card.column === "needs_you");
        })
        .catch(() => {});
      if (selectedRef.current) loadThread(selectedRef.current);
    },
  );

  // While the New thread dialog is up, the browser pane beside it shows the splash. Closing it goes back to
  // the open card's browser (a card just started is open by then), or the pane as it was.
  useEffect(() => {
    const bridge = window.threadboard;
    if (!showNew || !bridge) return;
    const before = bridge.browser.getState();
    // Run from a recipe, the pane shows the recipe's page: its blanks, what it makes and its last runs.
    const page = recipe ? Promise.resolve({ url: libraryPageUrl(recipe.id) }) : api.newThreadPage(newCwd ?? project);
    const shown = page.then(({ url }) => bridge.browser.open(url, NEW_THREAD_PANE)).catch(() => {});
    return () => {
      void Promise.all([before, shown]).then(([state]) => {
        bridge.browser.setActive(selectedRef.current);
        if (!selectedRef.current) bridge.browser.setVisible(state.visible);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the folder is read once, as the dialog opens
  }, [showNew, recipe]);

  // After the bridge has put the board's own browser back on screen (lib/use-desktop-bridge.ts runs first).
  useEffect(() => {
    if (!libraryPage.current || selectedId) return;
    showPage(libraryPage.current);
    libraryPage.current = null;
  }, [selectedId]);

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
        // A recipe picked on the New thread page (weft://recipe/<id>).
        case "run-recipe":
          if (payload) runRecipe(payload);
          break;
      }
    };
  });

  useEffect(() => window.threadboard?.onMenu((action, payload) => onMenu.current(action, payload)), []);

  const filtering = Boolean(project || query.trim());
  // Picking another project or changing the filter collapses the columns again.
  const view = `${project ?? ""}\n${query.trim()}`;
  const expandedColumns = expanded.view === view ? expanded.columns : [];

  const byColumn = useMemo(
    () => groupByColumn(cards, { project, query, sort, showArchived }, rootOf),
    [cards, project, query, sort, showArchived, rootOf],
  );
  const archivedCount = cards.filter((c) => c.archived && (!project || rootOf(c.cwd) === project)).length;
  // The Done cards on screen that Shift+E and "Archive all" file away.
  const doneToArchive = (byColumn.get("done") ?? []).filter((c) => !c.archived);
  // Backlog hides unless Settings turns it on, but never hides cards waiting in it.
  const backlogOn = useSyncExternalStore(subscribeBoardPrefs, showBacklog, () => false);
  const visibleColumns = COLUMNS.filter(
    (c) => c.id !== "backlog" || backlogOn || cards.some((card) => card.column === "backlog" && !card.archived),
  );

  const projectSummaries = useMemo<ProjectSummary[]>(
    () => summarizeProjects(projects, cards, rootOf),
    [projects, cards, rootOf],
  );

  const selected = cards.find((c) => c.id === selectedId) ?? null;
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
      { cards, selected, projectSummaries, home, doneToArchive, lastArchived, archivedCount, showArchived, rootOf },
      {
        openNew: () => openNew(),
        focusFilter,
        toggleCopilot,
        toggleBrowser,
        toggleTerminal,
        openSettings: () => setShowSettings(true),
        openHelp: () => setShowHelp(true),
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
    writePrefs({ project: path, sort });
    // Have a CLI ready in that folder for the next new thread.
    if (path) api.warm({ cwd: path }).catch(() => {});
  }

  function chooseSort(next: SortKey) {
    setSort(next);
    writePrefs({ project, sort: next });
  }

  function openNew(folder?: string) {
    setRecipe(null);
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


  // The New thread dialog filled in from a library recipe; a project's recipe runs in its folder.
  function openRecipe(item: LibraryItem) {
    select(null);
    setRecipe(item);
    setNewCwd(item.scope === "project" ? item.folder : undefined);
    setShowNew(true);
    const cwd = item.scope === "project" ? item.folder : (project ?? lastFolder());
    if (cwd) api.warm({ cwd }).catch(() => {});
  }

  function runRecipe(id: string) {
    api
      .library(null, true)
      .then(({ items }) => {
        const item = items.find((i) => i.id === id && i.kind === "recipe");
        if (item) openRecipe(item);
        else notify("That recipe isn't in the library any more.");
      })
      .catch(notify);
  }

  function openLibraryItem(item: LibraryItem) {
    if (!libraryPinned()) setLibraryOpen(null);
    setShowNew(false);
    const url = libraryPageUrl(item.id);
    if (!selectedRef.current) {
      showPage(url);
      return;
    }
    libraryPage.current = url;
    select(null);
  }

  // Files a card in the library. Haiku writes a recipe, so that one takes a few seconds.
  function star(card: Card, kind: LibraryKind) {
    // A thread in your home folder has no project, so it's yours.
    const scope = card.cwd === home ? "mine" : "project";
    if (kind === "recipe") setToast(`Saving “${card.title}” as a recipe…`);
    api
      .star(card.id, kind, scope)
      .then(({ item }) => {
        if (leavesBoard(kind, card)) {
          archiveCards([card], `Starred “${item.title}” as a to-do and took it off the board.`);
          return;
        }
        setToast(
          kind === "recipe" ? `Saved as the recipe “${item.title}”, /${item.skill}.` : `Starred “${item.title}” as a ${kind === "todo" ? "to-do" : "note"}.`,
          { label: "Show", run: () => setLibraryOpen(kind) },
        );
      })
      .catch(notify);
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
  // Registered last, so an open library drawer closes before the browser does.
  useEscape(Boolean(libraryOpen) && !selectedId && !showNew && !libraryPinned(), () => setLibraryOpen(null), { panel: true });

  function toggleTerminal() {
    setTerminalOpen((open) => !open);
  }

  // The desktop app gives the copilot its own window; in a browser tab it opens as a pop-up.
  function toggleCopilot() {
    if (window.threadboard) window.threadboard.copilot.toggle();
    else window.open("/copilot", "threadboard-copilot", "popup,width=420,height=680");
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

  const { onCardMenu, onColumnMenu, onStarMenu } = useBoardMenus({
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
    star,
    showLibrary: setLibraryOpen,
    toast: setToast,
    notify,
  });

  // The header badges' cards: the quality badge's fixes and the pile counter's commit walk-through.
  function improveQuality(cwd: string, prompt: string, title: string) {
    return create({
      title,
      prompt,
      cwd,
      backend: "claude",
      start: true,
    });
  }

  // A started card opens right away, so its browser shows the splash-style starter page (lib/glance.ts).
  async function create(input: NewCardInput) {
    const { card } = await api.create(input);
    if (input.start) select(card.id);
  }

  return (
    <div className="flex h-screen flex-col">
      <header
        className={`flex shrink-0 items-center gap-3 border-b border-line bg-panel ${mac ? "app-drag h-11 pl-[78px] pr-4" : "px-4 py-2.5"}`}
      >
        <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
          <img src="/logo.svg" alt="" width={18} height={18} />
          Weft
        </h1>
        <span className="text-[12px] text-muted">
          {running} running
          {waiting > 0 && <span className="text-warn"> · {waiting} need{waiting === 1 ? "s" : ""} you</span>}
        </span>
        <HeaderBadges cwd={selected?.cwd ?? project ?? latest?.cwd} cards={cards} start={improveQuality} notify={notify} toast={setToast} />
        <div className="flex-1" />
        <button
          onClick={toggleCopilot}
          title={hint("copilot", "Copilot")}
          className={`relative flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] ${copilotOpen ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-ink hover:bg-sunken"}`}
        >
          <Icon name="sparkles" size={14} /> Copilot
          {copilotNeedsYou && (
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-warn" title="The copilot needs you" />
          )}
        </button>
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
      </header>

      <ProjectBar
        projects={projectSummaries}
        total={cards.length}
        selected={project}
        onSelect={chooseProject}
        filter={
          <FilterBox
            query={query}
            onQuery={setQuery}
            matches={query.trim() ? topMatches(byColumn, FILTER_MATCHES) : []}
            onOpen={openCard}
            onSearchAll={() => openPalette(query)}
          />
        }
        sort={sort}
        onSort={chooseSort}
        home={home}
        onMenuOpenChange={setMenuOpen}
      />

      <div className="flex min-h-0 flex-1">
        <CrashGuard what="library" className="m-3 w-[220px] self-start">
        <LibraryRail
          open={libraryOpen}
          onOpen={setLibraryOpen}
          project={project}
          cards={cards}
          version={libraryVersion}
          onStar={(id, kind) => {
            const card = cards.find((c) => c.id === id);
            if (card) star(card, kind);
          }}
          onOpenItem={openLibraryItem}
          onRun={openRecipe}
          onOpenCard={(id) => {
            const card = cards.find((c) => c.id === id);
            if (card) openCard(card);
          }}
          notify={notify}
        />
        </CrashGuard>
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
                <div className="flex items-center justify-between px-3 pb-1.5 pt-2.5">
                  <h2 className={`text-[12.5px] font-medium ${column.id === "needs_you" && list.length ? "text-warn" : "text-ink"}`}>
                    {column.label}
                  </h2>
                  <span className="flex items-center gap-2 text-[11.5px] text-faint">
                    {column.id === "done" && archivedCount > 0 && (
                      <button onClick={() => setShowArchived((v) => !v)} className="hover:text-ink" aria-pressed={showArchived}>
                        {showArchived ? "Hide" : "Show"} {archivedCount} archived
                      </button>
                    )}
                    {list.length}
                  </span>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {shown.map((card) => (
                    <CrashGuard key={card.id} what="card" name={card.title}>
                    <CardView
                      card={card}
                      now={now}
                      selected={card.id === selectedId}
                      unseen={unseen.has(card.id)}
                      alsoHere={busyHere(cards, card)}
                      onOpen={() => openCard(card)}
                      onAnswer={(allow) => void api.answer(card.id, allow, undefined, card.pending?.id).catch(notify)}
                      onStop={() => void api.stop(card.id).catch(notify)}
                      onContextMenu={(e) => void onCardMenu(card, e)}
                      onStarMenu={(e) => void onStarMenu(card, e)}
                    />
                    </CrashGuard>
                  ))}
                  {shown.length < list.length && (
                    <button
                      onClick={() => setExpanded({ view, columns: [...expandedColumns, column.id] })}
                      className="rounded-lg px-2 py-1.5 text-center text-[12px] text-muted hover:bg-card hover:text-ink"
                    >
                      Show {list.length - shown.length} more
                    </button>
                  )}
                  {loaded && list.length === 0 && (
                    <p className="px-2 py-3 text-center text-[11.5px] leading-snug text-faint">{filtering ? "No matching cards" : EMPTY_HINT[column.id]}</p>
                  )}
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
          <NewCardDialog key={recipe?.id ?? "new"} cards={cards} home={home} recipe={recipe ?? undefined} defaultCwd={newCwd ?? project ?? undefined} recentCwd={[...cards].sort((a, b) => b.updatedAt - a.updatedAt).find((c) => c.cwd !== home)?.cwd} onClose={() => setShowNew(false)} onCreate={create} />
        ) : selected && (
          <CrashGuard key={selected.id} what="thread" name={selected.title} className="m-3 w-[360px] self-start">
          <ThreadPanel
            card={selected}
            onStarMenu={(e) => void onStarMenu(selected, e)}
            alsoHere={busyHere(cards, selected)}
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
            editTitle={renameId === selected.id}
          />
          </CrashGuard>
        )}

        {browserOpen && (
          <CrashGuard what="browser pane" className="m-3 w-[360px] self-start">
          <BrowserPane
            desktop={desktop}
            state={browser}
            obscured={showSettings || showPalette || showHelp || Boolean(login) || menuOpen}
            width={browserWidth}
            onWidth={setBrowserWidth}
            onClose={showNew ? () => setShowNew(false) : selected ? () => select(null) : toggleBrowser}
            expanded={framed}
          />
          </CrashGuard>
        )}
        </div>
      </div>

      <CrashGuard what="footer"><BoardFooter stats={footerStats} cwd={footerCwd} backend={footerBackend} onHelp={() => setShowHelp(true)} /></CrashGuard>
      {/* After the footer so an open card can stop just above it; z-40 keeps it over the card's backdrop. */}
      {terminalOpen && (
        <div style={NO_DRAG} className="relative z-40">
          <CrashGuard what="terminal" className="m-3">
          <TerminalDrawer key={terminalCwd} cwd={terminalCwd} height={terminalHeight} onHeight={setTerminalHeight} onClose={toggleTerminal} />
          </CrashGuard>
        </div>
      )}

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showHelp && <ShortcutsDialog onClose={() => setShowHelp(false)} />}
      <ModifierHint />
      {showPalette && <CommandPalette initialQuery={paletteQuery} items={paletteItems()} findPrompts={findPrompts} currentProject={project ? { path: project, name: folderName(project) } : null} onClose={() => setShowPalette(false)} />}
      {login && <LoginDialog login={login} onClose={() => setLogin(null)} />}

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
  );
}

// Library pages are served by Weft itself (app/api/library/[id]/page), so a to-do's ticks can save.
function libraryPageUrl(id: string) {
  return `${window.location.origin}/api/library/${id}/page`;
}

// In the board's own browser (no card open), or a new tab outside the desktop app.
function showPage(url: string) {
  if (window.threadboard) void window.threadboard.browser.open(url, "board");
  else window.open(url, "_blank");
}

