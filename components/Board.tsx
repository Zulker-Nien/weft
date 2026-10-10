"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, mergeThread, type BrowserState, type MenuAction, type NewCardInput } from "@/lib/client";
import { worktreeParent } from "@/lib/format";
import { busyHere } from "@/lib/overlap";
import { COLUMNS, type BoardEvent, type Card, type Column, type LoginView, type Project, type ThreadItem } from "@/lib/types";
import { useShortcutListener, useShortcuts } from "@/lib/hotkeys";
import { setTheme, THEMES } from "@/lib/theme";
import { playChime, preloadChimes } from "@/lib/chimes";
import {
  cardChangeEffects,
  groupByColumn,
  latestLimits,
  SORTERS,
  stepThrough,
  summarizeProjects,
  type ProjectSummary,
  type SortKey,
} from "@/lib/board-view";
import { useBoardEvents } from "@/lib/use-events";
import { useNow } from "@/lib/use-now";
import { useToast } from "@/lib/use-toast";
import { keepTypedText, useEscape } from "@/lib/use-escape";
import BrowserPane from "./BrowserPane";
import CardView from "./CardView";
import CommandPalette, { type PaletteItem } from "./CommandPalette";
import CoverageBadge from "./CoverageBadge";
import Icon from "./Icon";
import LoginDialog from "./LoginDialog";
import NewCardDialog from "./NewCardDialog";
import ProjectBar, { folderName, SORTS } from "./ProjectBar";
import SettingsDialog from "./SettingsDialog";
import ShortcutsDialog from "./ShortcutsDialog";
import StatusStrip from "./StatusStrip";
import ShiftKey from "./ShiftKey";
import ThreadPanel from "./ThreadPanel";

const CLOSED_BROWSER: BrowserState = {
  visible: false,
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
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

// The selected project and sort order, remembered per browser.
const VIEW_PREFS = "threadboard.view";

function readPrefs(): { project?: string | null; sort?: SortKey } {
  try {
    return JSON.parse(localStorage.getItem(VIEW_PREFS) ?? "{}");
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

const noopSubscribe = () => () => {};

export default function Board() {
  const [cards, setCards] = useState<Card[]>([]);
  const [home, setHome] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { toast, setToast, notify } = useToast();
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [streaming, setStreaming] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [dragOver, setDragOver] = useState<Column | null>(null);
  const [browser, setBrowser] = useState<BrowserState>(CLOSED_BROWSER);
  const [webBrowserOpen, setWebBrowserOpen] = useState(false);
  const [browserWidth, setBrowserWidth] = useState(560);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotNeedsYou, setCopilotNeedsYou] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<string | null>(null);
  // Worktree folder -> its main repo, from the server; the bar shows each worktree's cards under that repo.
  const [roots, setRoots] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
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
  const desktop = useSyncExternalStore(noopSubscribe, () => Boolean(window.threadboard), () => false);
  // On macOS the header doubles as the title bar, under the window's traffic lights.
  const mac = useSyncExternalStore(noopSubscribe, () => window.threadboard?.platform ?? "", () => "") === "darwin";
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

  useEffect(() => {
    const bridge = window.threadboard;
    if (!bridge) return;
    void bridge.browser.getState().then(setBrowser);
    const offBrowser = bridge.browser.onState(setBrowser);
    const offCopilot = bridge.copilot.onState((state) => setCopilotOpen(state.open));
    return () => {
      offBrowser();
      offCopilot();
    };
  }, []);

  // Each card has its own browser: show the open card's, and close those of cards that are gone.
  useEffect(() => {
    window.threadboard?.browser.setActive(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (cards.length) window.threadboard?.browser.prune(cards.map((c) => c.id));
  }, [cards]);

  useEffect(() => {
    window.threadboard?.setBadge(cards.filter((c) => c.column === "needs_you").length);
  }, [cards]);

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
      }
    };
  });

  useEffect(() => window.threadboard?.onMenu?.((action, payload) => onMenu.current(action, payload)), []);

  const filtering = Boolean(project || query.trim());
  // Picking another project or changing the filter collapses the columns again.
  const view = `${project ?? ""}\n${query.trim()}`;
  const expandedColumns = expanded.view === view ? expanded.columns : [];

  const byColumn = useMemo(
    () => groupByColumn(cards, { project, query, sort, showArchived }, rootOf),
    [cards, project, query, sort, showArchived, rootOf],
  );
  const archivedCount = cards.filter((c) => c.archived && (!project || rootOf(c.cwd) === project)).length;

  const projectSummaries = useMemo<ProjectSummary[]>(
    () => summarizeProjects(projects, cards, rootOf),
    [projects, cards, rootOf],
  );

  const selected = cards.find((c) => c.id === selectedId) ?? null;
  const browserOpen = desktop ? browser.visible : webBrowserOpen;
  const waiting = cards.filter((c) => c.column === "needs_you").length;
  const running = cards.filter((c) => c.column === "running").length;

  // Shortcuts that act on the board stand down while a dialog or the project menu is up.
  const boardKeys = !(showNew || showSettings || showHelp || showPalette || Boolean(login) || menuOpen);

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
    const ids = COLUMNS.map((c) => c.id);
    const column = current?.closest<HTMLElement>("[data-column]")?.dataset.column as Column | undefined;
    if (!current || !column) {
      const first = ids.map(inColumn).find((list) => list.length > 0);
      first?.[0].focus();
      return;
    }
    const list = inColumn(column);
    const row = list.indexOf(current);
    if (move.dx) {
      for (let i = ids.indexOf(column) + move.dx; i >= 0 && i < ids.length; i += move.dx) {
        const next = inColumn(ids[i]);
        if (next.length) {
          next[Math.min(row, next.length - 1)].focus();
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
    list[(at + 1) % list.length].focus();
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
    const command = (id: string, label: string, icon: PaletteItem["icon"], run: () => void, keys?: string, keywords?: string) =>
      ({ id: `cmd-${id}`, group: "Commands", label, icon, run, keys, keywords }) satisfies PaletteItem;
    const commands: PaletteItem[] = [
      command("new", "New thread", "plus", openNew, "n"),
      command("filter", "Filter cards", "search", focusFilter, "/"),
      command("copilot", "Toggle the copilot", "sparkles", toggleCopilot, "c"),
      command("browser", "Toggle the browser", "globe", toggleBrowser, "b"),
      command("settings", "Open settings", "sliders", () => setShowSettings(true), ","),
      command("help", "Show keyboard shortcuts", "zap", () => setShowHelp(true), "?", "hotkeys keys"),
      command("needs-you", "Jump to a card that needs you", "alert", () => void jumpToNeedsYou(), "a", "waiting"),
      ...SORTS.map((s) => command(`sort-${s.id}`, `Sort: ${s.label}`, "list", () => chooseSort(s.id), undefined, "order")),
      ...THEMES.map((t) => command(`theme-${t.id}`, `Theme: ${t.label}`, "sun", () => setTheme(t.id), undefined, "appearance dark light")),
    ];
    if (selected) {
      commands.unshift(
        command("reply", "Reply in the open thread", "send", () => {
          document.querySelector<HTMLElement>('aside [contenteditable="true"], aside textarea')?.focus();
        }, "r"),
        command("close", "Close the open thread", "x", () => select(null), "Escape"),
        ...(selected.column === "running" ? [command("stop", "Stop the open thread", "stop", () => api.stop(selected.id).catch(notify))] : []),
        ...COLUMNS.filter((c) => c.id !== selected.column).map((c) =>
          command(`move-${c.id}`, `Move the open thread to ${c.label}`, "forward", () => move(selected.id, c.id)),
        ),
      );
    }
    const projectItems = [null, ...projectSummaries.map((p) => p.path)].map((path): PaletteItem => ({
      id: `project-${path ?? "all"}`,
      group: "Projects",
      label: path ? folderName(path) : "All projects",
      detail: path ? (home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path) : undefined,
      keywords: "project folder",
      icon: "folder",
      run: () => chooseProject(path),
    }));
    const cardItems = cards
      .filter((c) => c.role !== "copilot")
      .toSorted(SORTERS.active)
      .map((card): PaletteItem => ({
        id: `card-${card.id}`,
        group: "Cards",
        label: card.title,
        detail: COLUMNS.find((c) => c.id === card.column)?.label,
        keywords: [card.prompt, card.lastLine, card.stage, card.remaining, folderName(card.cwd)].filter(Boolean).join(" "),
        icon: "file",
        run: () => openCard(card),
      }));
    return [...commands, ...projectItems, ...cardItems];
  }

  // The prompts the user wrote that match a query, as palette items that open their card.
  async function findPrompts(query: string): Promise<PaletteItem[]> {
    const { hits } = await api.searchPrompts(query);
    return hits.flatMap((hit, i): PaletteItem[] => {
      const card = cards.find((c) => c.id === hit.cardId);
      if (!card) return [];
      return [
        {
          id: `prompt-${hit.cardId}-${i}`,
          group: "Prompts",
          label: card.title,
          detail: COLUMNS.find((c) => c.id === card.column)?.label,
          snippet: hit.snippet.replace(/\s+/g, " "),
          icon: "file",
          run: () => openCard(card),
        },
      ];
    });
  }

  useShortcuts([
    {
      id: "palette",
      keys: ["mod+k"],
      description: "Command palette: search cards and run commands",
      group: "General",
      enabled: !(showNew || showSettings || showHelp || Boolean(login)),
      handler: () => setShowPalette((open) => !open),
    },
    {
      id: "help",
      keys: ["?", "mod+/"],
      description: "Show keyboard shortcuts",
      group: "General",
      enabled: !(showNew || showSettings || showPalette || Boolean(login)),
      handler: () => setShowHelp((open) => !open),
    },
    { id: "new-thread", keys: ["n"], description: "New thread", group: "General", enabled: boardKeys, handler: openNew },
    { id: "filter", keys: ["/"], description: "Filter cards", group: "General", enabled: boardKeys, handler: focusFilter },
    {
      id: "settings",
      keys: [","],
      description: "Open settings",
      group: "General",
      enabled: boardKeys,
      handler: () => setShowSettings(true),
    },
    { id: "copilot", keys: ["c"], description: "Toggle the copilot", group: "General", enabled: boardKeys, handler: toggleCopilot },
    { id: "browser", keys: ["b"], description: "Toggle the browser", group: "General", enabled: boardKeys, handler: toggleBrowser },
    {
      id: "card-down",
      keys: ["j", "ArrowDown"],
      description: "Next card in the column",
      group: "Board",
      enabled: boardKeys,
      handler: () => moveFocus({ dy: 1 }),
    },
    {
      id: "card-up",
      keys: ["k", "ArrowUp"],
      description: "Previous card in the column",
      group: "Board",
      enabled: boardKeys,
      handler: () => moveFocus({ dy: -1 }),
    },
    {
      id: "column-right",
      keys: ["l", "ArrowRight"],
      description: "Move to the next column",
      group: "Board",
      enabled: boardKeys,
      handler: () => moveFocus({ dx: 1 }),
    },
    {
      id: "column-left",
      keys: ["h", "ArrowLeft"],
      description: "Move to the previous column",
      group: "Board",
      enabled: boardKeys,
      handler: () => moveFocus({ dx: -1 }),
    },
    {
      id: "card-first",
      keys: ["Home"],
      description: "First card in the column",
      group: "Board",
      enabled: boardKeys,
      handler: () => moveFocus({ edge: "first" }),
    },
    {
      id: "card-last",
      keys: ["End"],
      description: "Last card in the column",
      group: "Board",
      enabled: boardKeys,
      handler: () => moveFocus({ edge: "last" }),
    },
    {
      id: "card-open",
      keys: ["Enter", "o"],
      description: "Open the focused card",
      group: "Board",
      enabled: boardKeys,
      handler: openFocused,
    },
    {
      id: "needs-you",
      keys: ["a"],
      description: "Jump to a card that needs you",
      group: "Board",
      enabled: boardKeys,
      handler: jumpToNeedsYou,
    },
    { id: "project-next", keys: ["]"], description: "Next project", group: "Board", enabled: boardKeys, handler: () => stepProject(1) },
    {
      id: "project-previous",
      keys: ["["],
      description: "Previous project",
      group: "Board",
      enabled: boardKeys,
      handler: () => stepProject(-1),
    },
    { id: "sort", keys: ["s"], description: "Change the sort order", group: "Board", enabled: boardKeys, handler: stepSort },
    {
      id: "reply",
      keys: ["r"],
      description: "Reply in the open thread",
      group: "Thread",
      enabled: boardKeys,
      handler: () => {
        const input = document.querySelector<HTMLElement>('aside [contenteditable="true"], aside textarea');
        if (!input) return false;
        input.focus();
      },
    },
    {
      id: "archive",
      keys: ["shift+a"],
      description: "Archive or unarchive the open thread",
      group: "Thread",
      enabled: boardKeys,
      handler: () => {
        if (!selected) return false;
        toggleArchive(selected);
      },
    },
  ]);
  useShortcutListener();

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

  function openNew() {
    setShowNew(true);
    const cwd = project ?? lastFolder();
    if (cwd) api.warm({ cwd }).catch(() => {});
  }

  // Archiving closes the thread; unarchiving leaves it open.
  function toggleArchive(card: Card) {
    const archived = !card.archived;
    if (archived) select(null);
    api.archive(card.id, archived).catch(notify);
  }

  function openCard(card: Card) {
    select(card.id);
    // Start its CLI now so a reply doesn't wait.
    if (!card.warm && card.column !== "done") api.warm({ cardId: card.id }).catch(() => {});
  }

  function toggleBrowser() {
    if (window.threadboard) window.threadboard.browser.setVisible(!browser.visible);
    else setWebBrowserOpen((open) => !open);
  }

  // Escape closes the newest open layer. The board's own panels sit under any dialog opened over them,
  // and an unsent reply isn't thrown away with its thread. The open card's browser closes with the card.
  useEscape(Boolean(selectedId), (e) => {
    if (!keepTypedText(e)) select(null);
  });
  useEscape(browserOpen && !selectedId, toggleBrowser);

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

  async function create(input: NewCardInput) {
    await api.create(input);
  }

  return (
    <div className="flex h-screen flex-col">
      <header
        className={`flex shrink-0 items-center gap-3 border-b border-line bg-panel ${mac ? "app-drag h-11 pl-[78px] pr-4" : "px-4 py-2.5"}`}
      >
        <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed 18px mark needs no optimizing */}
          <img src="/logo.svg" alt="" width={18} height={18} />
          Weft
        </h1>
        <span className="text-[12px] text-muted">
          {running} running
          {waiting > 0 && <span className="text-warn"> · {waiting} need{waiting === 1 ? "s" : ""} you</span>}
        </span>
        <CoverageBadge />
        <div className="flex-1" />
        <button
          onClick={toggleCopilot}
          className={`relative flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] ${copilotOpen ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-ink hover:bg-sunken"}`}
        >
          <Icon name="sparkles" size={14} /> Copilot
          {copilotNeedsYou && (
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-warn" title="The copilot needs you" />
          )}
        </button>
        <button
          onClick={toggleBrowser}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] ${browserOpen ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-ink hover:bg-sunken"}`}
        >
          <Icon name="globe" size={14} /> Browser
        </button>
        <button
          onClick={() => setShowSettings(true)}
          title="Settings"
          aria-label="Settings"
          className="rounded-md border border-line-strong p-1.5 text-muted hover:bg-sunken hover:text-ink"
        >
          <Icon name="sliders" size={15} />
        </button>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-on-accent hover:opacity-90"
        >
          <Icon name="plus" size={14} /> New thread
        </button>
      </header>

      <ProjectBar
        projects={projectSummaries}
        total={cards.length}
        selected={project}
        onSelect={chooseProject}
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={chooseSort}
        home={home}
        onMenuOpenChange={setMenuOpen}
      />

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 gap-3 overflow-x-auto p-3">
          {COLUMNS.map((column) => {
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
                    <CardView
                      key={card.id}
                      card={card}
                      now={now}
                      selected={card.id === selectedId}
                      unseen={unseen.has(card.id)}
                      alsoHere={busyHere(cards, card)}
                      onOpen={() => openCard(card)}
                      onAnswer={(allow) => api.answer(card.id, allow, undefined, card.pending?.id).catch(notify)}
                      onStop={() => api.stop(card.id).catch(notify)}
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
                  {loaded && list.length === 0 && (
                    <p className="px-2 py-3 text-center text-[11.5px] leading-snug text-faint">{filtering ? "No matching cards" : EMPTY_HINT[column.id]}</p>
                  )}
                  {column.id === "backlog" && (
                    <button
                      onClick={openNew}
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

        {selected && <div className="fixed inset-0 z-30 bg-black/40" onClick={() => select(null)} aria-hidden="true" />}
        <div className={selected ? "fixed inset-4 z-40 flex overflow-hidden rounded-xl border border-line-strong bg-panel shadow-2xl" : "contents"}>
        {selected && (
          <ThreadPanel
            key={selected.id}
            card={selected}
            alsoHere={busyHere(cards, selected)}
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
            onAnswer={(allow, answers) => api.answer(selected.id, allow, answers, selected.pending?.id).catch(notify)}
            onStop={() => api.stop(selected.id).catch(notify)}
            onRelease={() => api.release(selected.id).catch(notify)}
            onArchive={() => toggleArchive(selected)}
            onDelete={() => {
              select(null);
              api.remove(selected.id).catch(notify);
            }}
            onClose={() => select(null)}
            onRename={(title) => api.rename(selected.id, title).catch(notify)}
          />
        )}

        {browserOpen && (
          <BrowserPane
            desktop={desktop}
            state={browser}
            obscured={showNew || showSettings || showPalette || showHelp || Boolean(login) || menuOpen}
            width={browserWidth}
            onWidth={setBrowserWidth}
            onClose={toggleBrowser}
            expanded={Boolean(selected)}
          />
        )}
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-line bg-panel px-4 py-1.5">
        <StatusStrip stats={selected ? selected.stats : latestLimits(cards)} cwd={selected?.cwd} />
        <span className="shrink-0 whitespace-nowrap text-[11.5px] text-muted">
          <a href={REPO_URL} onClick={(e) => openLink(e, REPO_URL)} className="font-medium text-ink hover:text-accent">Weft</a> v{process.env.NEXT_PUBLIC_APP_VERSION} built with{" "}
          <a href={COFFEE_URL} onClick={(e) => openLink(e, COFFEE_URL)} title="Buy me a coffee">☕</a> by{" "}
          <a href="mailto:alex@aimhuge.com" className="hover:text-accent">alex@aimhuge.com</a>
        </span>
      </footer>

      {showNew && (
        <NewCardDialog cards={cards} home={home} defaultCwd={project ?? undefined} recentCwd={[...cards].sort((a, b) => b.updatedAt - a.updatedAt).find((c) => c.cwd !== home)?.cwd} limits={latestLimits(cards)} onClose={() => setShowNew(false)} onCreate={create} />
      )}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showHelp && <ShortcutsDialog onClose={() => setShowHelp(false)} />}
      <ShiftKey />
      {showPalette && <CommandPalette items={paletteItems()} findPrompts={findPrompts} onClose={() => setShowPalette(false)} />}
      {login && <LoginDialog login={login} onClose={() => setLogin(null)} />}

      {toast && (
        <div className="fixed bottom-4 left-4 z-50 flex max-w-md items-start gap-2 rounded-lg border border-danger/30 bg-panel px-3.5 py-2.5 text-[13px] text-ink shadow-lg">
          <Icon name="alert" size={15} className="mt-0.5 text-danger" />
          <span className="flex-1">{toast}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss" className="text-muted hover:text-ink">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

const REPO_URL = "https://github.com/fotoflo/weft";
const COFFEE_URL = "https://buymeacoffee.com/alexmiller";

// The desktop shell opens links in the default browser; the web build uses the link as is.
function openLink(e: React.MouseEvent, url: string) {
  if (!window.threadboard) return;
  e.preventDefault();
  window.threadboard.openExternal(url);
}
