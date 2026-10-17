"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { copilotLaneOpen, copilotLanePeek, showBacklog, subscribeBoardPrefs } from "@/lib/board-prefs";
import { laneStateFromPrefs, type LaneState } from "@/lib/copilot-lane";
import { api, mergeThread, type BrowserState, type MenuAction } from "@/lib/client";
import { worktreeParent } from "@/lib/format";
import { busyHere } from "@/lib/overlap";
import { planResets } from "@/lib/schedule";
import { COLUMNS, type BoardEvent, type Card, type Column, type LoginView, type Project, type ThreadItem } from "@/lib/types";
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
import { useNow } from "@/lib/use-now";
import { useToast } from "@/lib/use-toast";
import { useCopilotCard } from "@/lib/use-copilot-card";
import { useBoardCardActions } from "@/lib/use-board-card-actions";
import { useBoardView } from "@/lib/use-board-view";
import { useBoardArchive } from "@/lib/use-board-archive";
import { useBoardActions } from "@/lib/use-board-actions";
import { useBoardToggles } from "@/lib/use-board-toggles";
import { resumeActions } from "@/lib/resume-actions";
import { useEscape } from "@/lib/use-escape";
import { announceAccountChange } from "@/lib/use-account";
import CrashGuard from "./CrashGuard";
import { guarded } from "./guarded";
import type { PaletteItem } from "./CommandPalette";
import { boardPaletteItems, promptItems } from "./board-palette";
import { boardShortcuts } from "./board-shortcuts";
import { addSecret } from "@/lib/use-vault";
import { addWebhookAsk } from "@/lib/use-webhooks";
import { parseWebhookAsk } from "@/lib/webhooks-view";
import Icon from "./Icon";
import { filterCards, isFiltering, railPinned, toggleTag, type RailFilter, type RailPanel } from "@/lib/rail-view";
import { TagColors } from "./TagPill";
import { useTagCatalog } from "./use-tag-catalog";
import { useBoardMenus } from "./use-board-menus";
import { useSwitchAll } from "./switch-all-button";
import ProjectBar, { folderName } from "./ProjectBar";
import FilterBox from "./FilterBox";
import { NO_DRAG } from "@/lib/no-drag";
import { filterHasFocus as filterHasFocusImpl, focusFilter as focusFilterImpl, jumpToNeedsYou as jumpToNeedsYouImpl, moveFocus as moveFocusImpl, openFocused as openFocusedImpl } from "@/lib/board-focus";
import { announce, showPage, without } from "@/lib/board-helpers";
import BoardHeader from "./BoardHeader";
import BoardColumn, { COLUMN_LIMIT } from "./BoardColumn";
import BoardToast from "./BoardToast";

// Each loads in its own CrashGuard (components/guarded.tsx), so a piece a thread left half-written, even one that
// fails as its module loads, breaks only its own spot on the board.
const AccountButton = guarded(() => import("./AccountButton"), { inline: true, what: "account button" });
const CopilotButton = guarded(() => import("./CopilotButton"), { inline: true, what: "copilot button" });
const CopilotLane = guarded(() => import("./CopilotLane"), { what: "copilot", className: "self-stretch shrink-0" });
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
const GlanceRail = guarded(() => import("./GlanceRail"), { what: "glance rail", className: "w-[72px] shrink-0" });
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

// Cards the filter box lists under itself while typing.
const FILTER_MATCHES = 5;

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
  // Worktree folder -> its main repo, from the server; the bar shows each worktree's cards under that repo.
  const [roots, setRoots] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
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

  // Computed early so the hooks below (actions, toggles, archive) can take it as a dep.
  const laneOpen = useSyncExternalStore(subscribeBoardPrefs, copilotLaneOpen, () => false);
  const lanePeek = useSyncExternalStore(subscribeBoardPrefs, copilotLanePeek, () => false);
  const laneState: LaneState = laneStateFromPrefs(laneOpen, lanePeek);
  // The copilot opens in the same window as any card, though it lives apart from `cards`.
  const selected = cards.find((c) => c.id === selectedId) ?? (copilot?.id === selectedId ? copilot : null);
  // The most recent card's folder, for places that need a cwd when no card is open.
  const latest = latestLimits(cards);
  const latestCwd = latest?.cwd;

  // Drag/drop, tag, and the "skip my own move's chime" ref (used by useBoardEvents below).
  const { ownMoves, move, drop, tagCard } = useBoardCardActions({ cards, setDragOver, notify });
  // Project filter and sort, persisted to a cookie.
  const { project, sort, chooseProject, chooseSort, loadFromPrefs } = useBoardView({ select, setWebBrowserOpen });
  // Archive, unarchive, focus the next card, and the last batch (for Z / Undo).
  const { archiveTarget, archiveCards, toggleArchive, unarchive, lastArchived } = useBoardArchive({
    cards,
    selected,
    selectedIdRef: selectedRef,
    select,
    setToast,
    notify,
  });
  // Open, create, and the header badges' "start a card" callbacks.
  const { openCard, openNew, create, improveQuality, reviewAll } = useBoardActions({
    selected,
    select,
    setShowNew,
    setNewCwd,
    project,
    latestCwd,
    notify,
  });
  // Browser, terminal, and copilot-lane state.
  const { toggleBrowser, toggleTerminal, toggleCopilot, setCopilotState } = useBoardToggles({
    selectedRef,
    browserVisible: browser.visible,
    setWebBrowserOpen,
    setTerminalOpen,
    laneState,
    select,
  });

  // Live updates. The first open (and every reconnect) reloads everything, so nothing is missed.
  useBoardEvents(
    (event: BoardEvent) => {
      switch (event.type) {
        case "card":
          // The copilot is a thread too, but it has its own lane and no project.
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
      loadFromPrefs();
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

  // The menu, dock, tray, and shortcuts reach the board through onMenu, which always sees the latest
  // state via this ref (the actions live below, defined after this effect).
  const menuActions = useRef<{ openNew: () => void; openCard: (card: Card) => void; focusFilter: () => void; toggleTerminal: () => void }>({
    openNew: () => {},
    openCard: () => {},
    focusFilter: () => {},
    toggleTerminal: () => {},
  });
  useEffect(() => {
    onMenu.current = (action, payload) => {
      switch (action) {
        case "new-thread":
          menuActions.current.openNew();
          break;
        case "settings":
          setShowSettings(true);
          break;
        case "open-card": {
          const card = cards.find((c) => c.id === payload);
          if (card) menuActions.current.openCard(card);
          else if (payload) select(payload);
          break;
        }
        case "find":
          menuActions.current.focusFilter();
          break;
        case "terminal":
          menuActions.current.toggleTerminal();
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

  // An open card, or the New thread form, fills a framed window with the browser pane beside it.
  const framed = Boolean(selected) || showNew;
  // The most recent card's stats (and folder/backend), so the footer has a model/folder to show
  // when no card is open. Account-wide limits live in here too.
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

  function openPalette(initial: string) {
    setPaletteQuery(initial.trim());
    setShowPalette(true);
  }

  // Steps through the project filter: "All projects", then each project in the bar's order.
  function stepProject(by: number) {
    chooseProject(stepThrough([null, ...projectSummaries.map((p) => p.path)], project, by));
  }

  function stepSort() {
    chooseSort(stepThrough(Object.keys(SORTERS) as SortKey[], sort, 1));
  }

  // Focus helpers (lib/board-focus.ts) — bound to the board's column / card layout.
  const filterHasFocus = () => filterHasFocusImpl();
  const focusFilter = () => focusFilterImpl();
  const moveFocus = (move: { dx?: number; dy?: number; edge?: "first" | "last" }) =>
    moveFocusImpl(move, visibleColumns, selectedId, selected?.column ?? null);
  const jumpToNeedsYou = () => jumpToNeedsYouImpl();
  const openFocused = (e: KeyboardEvent) => openFocusedImpl(e, cards, openCard);

  // Keep the menu's actions in sync (the effect above runs every render and reads the latest).
  useEffect(() => {
    menuActions.current = { openNew, openCard, focusFilter, toggleTerminal };
  });

  // Everything the command palette offers: the board's actions, the projects, and every card.
  // Computed lazily: only when the palette is open (`showPalette`), so creating a fresh array of
  // items every render would just churn. Each callback is wrapped so the type analyzer doesn't tag
  // a useCallback return as a ref passed into boardPaletteItems.
  function paletteItems(): PaletteItem[] {
    return showPalette
      ? boardPaletteItems(
          { cards, selected, projectSummaries, home, doneToArchive, lastArchived, archivedCount, showArchived, rootOf, restartArmed: !!restartView.restart?.armed },
          {
            openNew: () => openNew(),
            focusFilter: () => focusFilter(),
            toggleCopilot: () => toggleCopilot(),
            toggleBrowser: () => toggleBrowser(),
            toggleTerminal: () => toggleTerminal(),
            openSettings: () => setShowSettings(true),
            openHelp: () => setShowHelp(true),
            addSecret: () => addSecret(setLibraryOpen),
            jumpToNeedsYou: () => void jumpToNeedsYou(),
            archiveCards: (l: Card[]) => archiveCards(l),
            unarchive: (ids: string[]) => unarchive(ids),
            toggleShowArchived: () => setShowArchived((v) => !v),
            chooseSort: (s: SortKey) => chooseSort(s),
            focusReply: () => document.querySelector<HTMLElement>('aside [contenteditable="true"], aside textarea')?.focus(),
            closeThread: () => select(null),
            toggleArchive: (c: Card) => toggleArchive(c),
            stop: (id: string) => void api.stop(id).catch(notify),
            move: (id: string, column: Column) => move(id, column),
            chooseProject: (p: string | null) => chooseProject(p),
            openCard: (c: Card) => openCard(c),
            toast: setToast,
          },
        )
      : [];
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

  // Escape closes the newest open layer. The board's own panels sit under any dialog or menu, even one
  // opened before them. The thread closes even mid-reply: ReplyBox keeps the draft for next time. A card
  // and its browser are one window, so they close together.
  useEscape(Boolean(selectedId), () => select(null), { panel: true });
  useEscape(browserOpen && !selectedId && !showNew, toggleBrowser, { panel: true });
  // Registered last, so an open rail drawer closes before the browser does.
  useEscape(Boolean(libraryOpen) && !selectedId && !showNew && !railPinned(), () => setLibraryOpen(null), { panel: true });

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

  return (
    <TagColors.Provider value={tagCatalog.colors}>
    <div className="flex h-screen flex-col">
      <BoardHeader
        mac={mac}
        running={running}
        waiting={waiting}
        browserOpen={browserOpen}
        terminalOpen={terminalOpen}
        hint={hint}
        onToggleBrowser={toggleBrowser}
        onToggleTerminal={toggleTerminal}
        onOpenSettings={() => setShowSettings(true)}
        onOpenNew={() => openNew()}
        restartChip={<RestartChip restart={restartView.restart} notify={notify} />}
        headerBadges={
          <HeaderBadges
            cwd={selected?.cwd ?? project ?? latest?.cwd}
            cards={cards}
            start={improveQuality}
            notify={notify}
            toast={setToast}
          />
        }
        copilotButton={
          <CopilotButton open={laneOpen} needsYou={copilotNeedsYou} title={hint("copilot", "Copilot")} onClick={toggleCopilot} />
        }
        accountButton={<AccountButton onOpenSettings={() => setShowSettings(true)} />}
      />

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
            const count = list.length;
            return (
              <BoardColumn
                key={column.id}
                column={column}
                shown={shown}
                count={count}
                loaded={loaded}
                filtering={filtering}
                dragOver={dragOver === column.id}
                laneState={laneState}
                onShowMore={() => setExpanded({ view, columns: [...expandedColumns, column.id] })}
                renderCard={(card) => (
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
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(column.id);
                }}
                onDragLeave={() => setDragOver((c) => (c === column.id ? null : c))}
                onDrop={(e) => drop(column.id, e)}
                onColumnContextMenu={(e) => void onColumnMenu(column.id, e)}
                needsYou={column.id === "needs_you" && count > 0}
                archivedCount={archivedCount}
                showArchived={showArchived}
                onToggleArchived={() => setShowArchived((v) => !v)}
                toArchive={doneToArchive.length}
                archiveTip={hint("archive-done", `Archive all ${doneToArchive.length}`)}
                onArchiveAll={() => archiveCards(doneToArchive)}
                resumeAll={column.id === "review" ? resumeAll : undefined}
                onSwitchAll={
                  limitHit && (column.id === "running" || column.id === "needs_you")
                    ? () => switchAll(column.id)
                    : undefined
                }
                onReviewAll={column.id === "review" ? reviewAll : undefined}
                onAddBacklog={() => openNew()}
              />
            );
          })}
        </main>
        <CopilotLane
          state={laneState}
          cards={cards}
          project={project}
          onOpenCard={openCard}
          onHide={() => setCopilotState("hidden")}
          onPeek={() => setCopilotState("peek")}
          onOpen={() => setCopilotState("open")}
          toggleTip={hint("copilot", "Copilot")}
        />

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
            rail={<GlanceRail card={selected} hidden={showNew} items={thread} pageUrl={browser.url} />}
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
      {showPalette && (
        // The palette items accessor passes useCallback returns (which the type analyzer flags as
        // ref-readers); it's invoked only when the palette is open, and the lint rule's heuristic
        // doesn't have visibility into the conditional.
        // eslint-disable-next-line react-hooks/refs
        <CommandPalette initialQuery={paletteQuery} items={paletteItems()} findPrompts={findPrompts} currentProject={project ? { path: project, name: folderName(project) } : null} onClose={() => setShowPalette(false)} />
      )}
      {login && <LoginDialog login={login} onClose={() => setLogin(null)} />}
      {switchAllDialog}

      {toast && (
        <BoardToast text={toast.text} action={toast.action} onDismiss={() => setToast(null)} />
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

