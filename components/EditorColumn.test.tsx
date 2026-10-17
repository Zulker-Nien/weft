// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenedFile } from "@/lib/client-files";

// Mock lib/client-files so the column's stat poll and reads use fake in-memory data.
const { filesApi, FileConflictError } = vi.hoisted(() => {
  class FileConflictErrorLocal extends Error {
    current: OpenedFile;
    constructor(current: OpenedFile) {
      super(`${current.path} changed on disk since you opened it.`);
      this.name = "FileConflictError";
      this.current = current;
    }
  }
  return {
    filesApi: { read: vi.fn(), stat: vi.fn(), head: vi.fn(), list: vi.fn(), write: vi.fn() },
    FileConflictError: FileConflictErrorLocal,
  };
});

vi.mock("@/lib/client-files", () => ({ filesApi, FileConflictError }));

// Stub the heavy editors so jsdom doesn't have to host CodeMirror or TipTap. Each stub is a plain
// div that surfaces its props in data-* attributes the test can read.
const codeProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const diffProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const mdProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("./CodeEditor", () => ({
  default: (props: Record<string, unknown>) => {
    codeProps.current = props;
    return <div data-testid="code-editor" data-path={typeof props.path === "string" ? props.path : ""} />;
  },
}));
vi.mock("./DiffEditor", () => ({
  default: (props: Record<string, unknown>) => {
    diffProps.current = props;
    return <div data-testid="diff-editor" data-path={typeof props.path === "string" ? props.path : ""} />;
  },
}));
vi.mock("./MarkdownEditor", () => ({
  default: (props: Record<string, unknown>) => {
    mdProps.current = props;
    return <div data-testid="markdown-editor" data-path={typeof props.path === "string" ? props.path : ""} />;
  },
}));
// QuickOpen is the ⌘P picker; for the column test we mock it to a div that exposes its handlers.
const quickProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("./QuickOpen", () => ({
  default: (props: Record<string, unknown>) => {
    quickProps.current = props;
    return <div data-testid="quick-open" />;
  },
}));

import EditorColumn from "./EditorColumn";
import { openFile, drainOpenFiles } from "@/lib/open-file";

const cardId = "card-1";
const cwd = "/Users/me/app";

function file(over: Partial<OpenedFile> = {}): OpenedFile {
  return { path: "lib/x.ts", exists: true, text: "hello", hash: "h1", mtime: 1000, size: 5, ...over };
}

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  // The open-file queue is module-level; drain every card we've used so prior tests don't leak.
  drainOpenFiles(cardId);
  drainOpenFiles("other");
  codeProps.current = null;
  diffProps.current = null;
  mdProps.current = null;
  quickProps.current = null;
  filesApi.read.mockResolvedValue(file());
  filesApi.stat.mockResolvedValue({ exists: true, mtime: 1000, size: 5 });
  filesApi.head.mockResolvedValue(null);
  filesApi.list.mockResolvedValue(["lib/x.ts", "README.md"]);
  filesApi.write.mockResolvedValue({ hash: "h2", mtime: 2000 });
});

afterEach(cleanup);

describe("EditorColumn", () => {
  it("shows the empty state with the ⌘P hint when no tabs are open", () => {
    render(<EditorColumn cardId={cardId} cwd={cwd} onClose={() => {}} />);
    expect(screen.getByText("No file open")).toBeInTheDocument();
    expect(screen.getByText("⌘P")).toBeInTheDocument();
  });

  it("opens a tab when openFile fires for this card", async () => {
    render(<EditorColumn cardId={cardId} cwd={cwd} onClose={() => {}} />);
    openFile({ cardId, path: "lib/x.ts" });
    await waitFor(() => expect(screen.getByRole("tab", { name: /x\.ts/ })).toBeInTheDocument());
  });

  it("drains queued open-file requests on mount", async () => {
    openFile({ cardId, path: "lib/y.ts" });
    openFile({ cardId, path: "lib/z.ts" });
    render(<EditorColumn cardId={cardId} cwd={cwd} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole("tab", { name: /z\.ts/ })).toBeInTheDocument());
    // The drain picked both up; the second is the active tab.
    expect(drainOpenFiles(cardId)).toHaveLength(0);
  });

  it("opens a markdown tab and renders the markdown editor", async () => {
    filesApi.read.mockResolvedValue(file({ path: "README.md", text: "# hi", hash: "mh" }));
    render(<EditorColumn cardId={cardId} cwd={cwd} onClose={() => {}} />);
    openFile({ cardId, path: "README.md" });
    await waitFor(() => expect(screen.getByTestId("markdown-editor")).toBeInTheDocument());
    expect(mdProps.current?.path).toBe("README.md");
  });

  it("opens a code tab in Changes mode when the request asks for it", async () => {
    filesApi.head.mockResolvedValue("old version");
    render(<EditorColumn cardId={cardId} cwd={cwd} onClose={() => {}} />);
    openFile({ cardId, path: "lib/x.ts", diff: true });
    await waitFor(() => expect(screen.getByTestId("diff-editor")).toBeInTheDocument());
  });

  it("ignores open-file requests for other cards", () => {
    render(<EditorColumn cardId={cardId} cwd={cwd} onClose={() => {}} />);
    openFile({ cardId: "other", path: "lib/x.ts" });
    // No tab appears for our card.
    expect(screen.queryByRole("tab", { name: /x\.ts/ })).not.toBeInTheDocument();
  });

  it("ignores paths that escape cwd", () => {
    render(<EditorColumn cardId={cardId} cwd={cwd} onClose={() => {}} />);
    openFile({ cardId, path: "/etc/hosts" });
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(<EditorColumn cardId={cardId} cwd={cwd} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close editor column" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opens QuickOpen when ⌘P is pressed", async () => {
    render(<EditorColumn cardId={cardId} cwd={cwd} onClose={() => {}} />);
    await userEvent.keyboard("{Meta>}p{/Meta}");
    await waitFor(() => expect(screen.getByTestId("quick-open")).toBeInTheDocument());
    expect(quickProps.current?.cardId).toBe(cardId);
  });

  it("closes the active tab on ⌘W", async () => {
    render(<EditorColumn cardId={cardId} cwd={cwd} onClose={() => {}} />);
    openFile({ cardId, path: "lib/x.ts" });
    await waitFor(() => expect(screen.getByRole("tab", { name: /x\.ts/ })).toBeInTheDocument());
    await userEvent.keyboard("{Meta>}w{/Meta}");
    await waitFor(() => expect(screen.queryByRole("tab", { name: /x\.ts/ })).not.toBeInTheDocument());
  });

  it("persists tabs to localStorage on change", async () => {
    render(<EditorColumn cardId={cardId} cwd={cwd} onClose={() => {}} />);
    openFile({ cardId, path: "lib/x.ts" });
    await waitFor(() => expect(screen.getByRole("tab", { name: /x\.ts/ })).toBeInTheDocument());
    const stored = localStorage.getItem(`weft-editor-tabs:${cardId}`);
    expect(stored).not.toBeNull();
    expect((JSON.parse(stored as string) as { tabs: { path: string }[] }).tabs.map((t) => t.path)).toContain("lib/x.ts");
  });

  it("switches between Edit and Changes mode for a code file via the tab pill", async () => {
    filesApi.head.mockResolvedValue("old version");
    render(<EditorColumn cardId={cardId} cwd={cwd} onClose={() => {}} />);
    openFile({ cardId, path: "lib/x.ts" });
    await waitFor(() => expect(screen.getByTestId("code-editor")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Editor mode"), "changes");
    await waitFor(() => expect(screen.getByTestId("diff-editor")).toBeInTheDocument());
  });
});