"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, mergeThread, type BrowserState, type MenuAction, type NewCardInput } from "@/lib/client";
import { COLUMNS, type BoardEvent, type Card, type Column, type LoginView, type Project, type ThreadItem } from "@/lib/types";
import { useShortcutListener, useShortcuts } from "@/lib/hotkeys";
import { setTheme, THEMES } from "@/lib/theme";
import { useBoardEvents } from "@/lib/use-events";
import { keepTypedText, useEscape } from "@/lib/use-escape";
import BrowserPane from "./BrowserPane";
import CardView from "./CardView";
import CommandPalette, { type PaletteItem } from "./CommandPalette";
import Icon from "./Icon";
import LoginDialog from "./LoginDialog";
import NewCardDialog from "./NewCardDialog";
import ProjectBar, { folderName, SORTS, type ProjectSummary, type SortKey } from "./ProjectBar";
import SettingsDialog from "./SettingsDialog";
import ShortcutsDialog from "./ShortcutsDialog";
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

// When a card's thread last moved. A card picked up from Claude Code carries its session's last message
// time; its updatedAt also changes when the board only reads the transcript.
const activeAt = (card: Card) => card.lastActivity ?? card.updatedAt;

const SORTERS: Record<SortKey, (a: Card, b: Card) => number> = {
  newest: (a, b) => b.createdAt - a.createdAt,
  active: (a, b) => activeAt(b) - activeAt(a),
  oldest: (a, b) => a.createdAt - b.createdAt,
  cost: (a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0),
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

// The clock for "5m ago" labels. It reads 0 during prerender, where the current time isn't allowed,
// and starts ticking once the board is in the browser.
let clock = 0;
function subscribeClock(onTick: () => void) {
  clock = Date.now();
  const timer = setInterval(() => {
    clock = Date.now();
    onTick();
  }, 30_000);
  return () => clearInterval(timer);
}

function useNow() {
  return useSyncExternalStore(subscribeClock, () => clock, () => 0);
}

export default function Board() {
  const [cards, setCards] = useState<Card[]>([]);
  const [home, setHome] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [streaming, setStreaming] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<Column | null>(null);
  const [browser, setBrowser] = useState<BrowserState>(CLOSED_BROWSER);
  const [webBrowserOpen, setWebBrowserOpen] = useState(false);
  const [browserWidth, setBrowserWidth] = useState(560);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotNeedsYou, setCopilotNeedsYou] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<string | null>(null);
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
  const selectedRef = useRef<string | null>(null);
  const now = useNow();
  const desktop = useSyncExternalStore(noopSubscribe, () => Boolean(window.threadboard), () => false);
  // On macOS the header doubles as the title bar, under the window's traffic lights.
  const mac = useSyncExternalStore(noopSubscribe, () => window.threadboard?.platform ?? "", () => "") === "darwin";
  const onMenu = useRef<(action: MenuAction, payload?: string) => void>(() => {});

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  const notify = useCallback((err: unknown) => {
    setToast(err instanceof Error ? err.message : String(err));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

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

  const select = useCallback(
    (id: string | null) => {
      selectedRef.current = id;
      setSelectedId(id);
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
            setCopilotNeedsYou(event.card.column === "needs_you");
            break;
          }
          {
            const previous = columns.current.get(event.card.id);
            columns.current.set(event.card.id, event.card.column);
            if (previous && previous !== event.card.column) announce(event.card, () => select(event.card.id));
          }
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
          setCards(data.cards);
          setHome(data.home);
          setLoaded(true);
        })
        .catch(notify);
      api
        .settings()
        .then((settings) => setProjects(settings.projects))
        .catch(() => {});
      const prefs = readPrefs();
      if (prefs.project !== undefined) setProject(prefs.project);
      if (prefs.sort && prefs.sort in SORTERS) setSort(prefs.sort);
      api
        .copilot()
        .then(({ card }) => setCopilotNeedsYou(card.column === "needs_you"))
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

  const byColumn = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const groups = new Map<Column, Card[]>(COLUMNS.map((c) => [c.id, []]));
    for (const card of cards) {
      if (project && card.cwd !== project) continue;
      if (card.archived && !showArchived) continue;
      if (needle) {
        const haystack = [card.title, card.prompt, card.lastLine, card.stage, card.remaining].join(" ").toLowerCase();
        if (!haystack.includes(needle)) continue;
      }
      groups.get(card.column)?.push(card);
    }
    for (const list of groups.values()) list.sort(SORTERS[sort]);
    return groups;
  }, [cards, project, query, sort, showArchived]);
  const archivedCount = cards.filter((c) => c.archived && (!project || c.cwd === project)).length;

  // Recent projects: saved ones plus every folder a card runs in, most recently active first.
  const projectSummaries = useMemo<ProjectSummary[]>(() => {
    const byPath = new Map<string, ProjectSummary>();
    const summary = (path: string) => {
      let s = byPath.get(path);
      if (!s) byPath.set(path, (s = { path, lastActivity: 0, cards: 0, running: 0, needsYou: 0 }));
      return s;
    };
    for (const p of projects) summary(p.path).lastActivity = Math.max(summary(p.path).lastActivity, p.lastUsedAt);
    for (const card of cards) {
      const s = summary(card.cwd);
      s.cards += 1;
      s.lastActivity = Math.max(s.lastActivity, activeAt(card));
      if (card.column === "running") s.running += 1;
      if (card.column === "needs_you") s.needsYou += 1;
    }
    return [...byPath.values()].sort((a, b) => b.lastActivity - a.lastActivity);
  }, [projects, cards]);

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
    const options = [null, ...projectSummaries.map((p) => p.path)];
    const at = Math.max(0, options.indexOf(project));
    chooseProject(options[(at + by + options.length) % options.length]);
  }

  function stepSort() {
    const keys = Object.keys(SORTERS) as SortKey[];
    chooseSort(keys[(keys.indexOf(sort) + 1) % keys.length]);
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
          command(`move-${c.id}`, `Move the open thread to ${c.label}`, "forward", () => api.move(selected.id, c.id).catch(notify)),
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
  // and an unsent reply isn't thrown away with its thread panel.
  useEscape(Boolean(selectedId), (e) => {
    if (!keepTypedText(e)) select(null);
  });
  useEscape(browserOpen, toggleBrowser);

  // The desktop app gives the copilot its own window; in a browser tab it opens as a pop-up.
  function toggleCopilot() {
    if (window.threadboard) window.threadboard.copilot.toggle();
    else window.open("/copilot", "threadboard-copilot", "popup,width=420,height=680");
  }

  function drop(column: Column, e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/plain");
    const card = cards.find((c) => c.id === id);
    if (card && card.column !== column) api.move(id, column).catch(notify);
  }

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
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed 18px mark needs no optimizing */}
          <img src="/logo.svg" alt="" width={18} height={18} />
          Weft
        </h1>
        <span className="text-[12px] text-muted">
          {running} running
          {waiting > 0 && <span className="text-warn"> · {waiting} need{waiting === 1 ? "s" : ""} you</span>}
        </span>
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
                      onOpen={() => openCard(card)}
                      onAnswer={(allow) => api.answer(card.id, allow, undefined, card.pending?.id).catch(notify)}
                      onStop={() => api.stop(card.id).catch(notify)}
                      onRename={(title) => api.rename(card.id, title).catch(notify)}
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

        {selected && (
          <ThreadPanel
            key={selected.id}
            card={selected}
            items={thread}
            streaming={streaming}
            onSend={async (text) => {
              await api.send(selected.id, text);
            }}
            onAnswer={(allow, answers) => api.answer(selected.id, allow, answers, selected.pending?.id).catch(notify)}
            onStop={() => api.stop(selected.id).catch(notify)}
            onArchive={() => {
              const archived = !selected.archived;
              if (archived) select(null);
              api.archive(selected.id, archived).catch(notify);
            }}
            onDelete={() => {
              select(null);
              api.remove(selected.id).catch(notify);
            }}
            onClose={() => select(null)}
          />
        )}

        {browserOpen && (
          <BrowserPane
            desktop={desktop}
            state={browser}
            obscured={showNew || showSettings || showPalette || Boolean(login) || menuOpen}
            width={browserWidth}
            onWidth={setBrowserWidth}
            onClose={toggleBrowser}
          />
        )}
      </div>

      {showNew && (
        <NewCardDialog home={home} defaultCwd={project ?? undefined} limits={latestLimits(cards)} onClose={() => setShowNew(false)} onCreate={create} />
      )}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showHelp && <ShortcutsDialog onClose={() => setShowHelp(false)} />}
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

// The newest plan rate limits any thread has seen; they're account-wide.
function latestLimits(cards: Card[]) {
  const withLimits = cards.filter((c) => c.stats?.fiveHour || c.stats?.sevenDay);
  const latest = withLimits.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.stats;
  return latest && { fiveHour: latest.fiveHour, sevenDay: latest.sevenDay };
}
