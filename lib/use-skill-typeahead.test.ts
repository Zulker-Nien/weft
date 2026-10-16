// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillInfo } from "./types";

const api = vi.hoisted(() => ({ skills: vi.fn() }));
vi.mock("./client", () => ({ api }));
// useEditorState subscribes to a live editor; here it just runs the selector on the fake one.
vi.mock("@tiptap/react", () => ({
  useEditorState: ({ editor, selector }: { editor: unknown; selector: (ctx: { editor: unknown }) => unknown }) => selector({ editor }),
}));

import { useSkillTypeahead } from "./use-skill-typeahead";

const skill = (name: string) => ({ name, description: "" }) as SkillInfo;

function editorAt(text: string | null) {
  if (text === null) return null;
  return {
    state: {
      selection: { empty: true, $from: { pos: 1 + text.length, parentOffset: text.length, parent: { textBetween: () => text } } },
      doc: { textContent: text },
    },
    isActive: () => false,
  } as unknown as Editor;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.skills.mockResolvedValue({ skills: [skill("deploy"), skill("deck"), skill("commit")] });
});

describe("useSkillTypeahead", () => {
  it("is closed and never fetches without a slash query", () => {
    const { result } = renderHook(() => useSkillTypeahead(editorAt("hello"), "/proj"));
    expect(result.current.query).toBeNull();
    expect(result.current.typeaheadOpen).toBe(false);
    expect(api.skills).not.toHaveBeenCalled();
    const none = renderHook(() => useSkillTypeahead(null, undefined));
    expect(none.result.current.query).toBeNull();
  });

  it("fetches the folder's skills for a slash query and ranks them", async () => {
    const { result } = renderHook(() => useSkillTypeahead(editorAt("/de"), "/proj"));
    expect(api.skills).toHaveBeenCalledWith("/proj");
    await waitFor(() => expect(result.current.typeaheadOpen).toBe(true));
    expect(result.current.suggestions.map((s) => s.name)).toEqual(expect.arrayContaining(["deploy", "deck"]));
    expect(result.current.suggestions.map((s) => s.name)).not.toContain("commit");
  });

  it("keeps the highlight per query and moves it with setActive", async () => {
    const { result, rerender } = renderHook(({ text }) => useSkillTypeahead(editorAt(text), "/proj"), { initialProps: { text: "/de" } });
    await waitFor(() => expect(result.current.typeaheadOpen).toBe(true));
    act(() => result.current.setActive(1));
    expect(result.current.active).toBe(1);
    act(() => result.current.setActive((i) => i + 1));
    expect(result.current.active).toBe(2);
    rerender({ text: "/dec" });
    expect(result.current.active).toBe(0);
  });

  it("closes when dismissed at its start, and forgets the dismissal when the slash goes", async () => {
    const { result, rerender } = renderHook(({ text }) => useSkillTypeahead(editorAt(text), "/proj"), { initialProps: { text: "/de" } });
    await waitFor(() => expect(result.current.typeaheadOpen).toBe(true));
    act(() => result.current.setDismissedAt(result.current.query?.from ?? null));
    expect(result.current.typeaheadOpen).toBe(false);
    rerender({ text: "gone" });
    expect(result.current.dismissedAt).toBeNull();
  });

  it("survives a failed fetch and ignores a reply that lands after the query closed", async () => {
    api.skills.mockRejectedValueOnce(new Error("offline"));
    const failing = renderHook(() => useSkillTypeahead(editorAt("/de"), "/proj"));
    await waitFor(() => expect(api.skills).toHaveBeenCalled());
    expect(failing.result.current.typeaheadOpen).toBe(false);

    let resolve: (v: { skills: SkillInfo[] }) => void = () => {};
    api.skills.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { result, rerender } = renderHook(({ text }) => useSkillTypeahead(editorAt(text), "/proj"), { initialProps: { text: "/de" } });
    rerender({ text: "done" });
    await act(() => {
      resolve({ skills: [skill("deploy")] });
      return Promise.resolve();
    });
    rerender({ text: "/de" });
    expect(result.current.suggestions).toEqual([]);
  });
});
