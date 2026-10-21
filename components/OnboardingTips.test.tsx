// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import { OPEN_NEW_THREAD } from "@/lib/onboarding-events";
import { TIPS_KEY } from "@/lib/tips";
import OnboardingTips from "./OnboardingTips";

// The board's onboarding layer: the empty board's start panel and the one-time coach tips under each
// column header. LoomDialog is stubbed; the column and board are plain DOM with a fixed rect.
vi.mock("next/dynamic", () => ({ default: () => (p: { onClose: () => void }) => <button onClick={p.onClose}>loom</button> }));

const flush = () => act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));

function boardDom() {
  document.body.innerHTML = '<main class="board-sheet"><section data-column="needs_you"><h3></h3></section><section data-column="done"><h3></h3></section></main>';
  for (const el of document.querySelectorAll<HTMLElement>(".board-sheet, section")) el.getBoundingClientRect = () => ({ top: 0, left: 0, width: 260, height: 500, bottom: 40 }) as DOMRect;
}

describe("OnboardingTips", () => {
  beforeEach(() => {
    localStorage.clear();
    boardDom();
  });

  it("offers New thread and the starters on an empty board", async () => {
    const opened = vi.fn();
    window.addEventListener(OPEN_NEW_THREAD, (e) => void opened((e as CustomEvent<unknown>).detail));
    render(<OnboardingTips cards={[]} loaded filtering={false} />, { container: document.body.appendChild(document.createElement("div")) });
    await flush();
    expect(screen.getByText("Start your first thread")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New thread ⌘N" }));
    await userEvent.click(screen.getByRole("button", { name: /Fix a bug/ }));
    expect(opened).toHaveBeenNthCalledWith(1, {});
    expect(opened).toHaveBeenNthCalledWith(2, { prompt: "Find one real bug in this project and fix it." });
  });

  it("shows the needs-you tip under its column until Got it", async () => {
    render(<OnboardingTips cards={[makeCard({ column: "needs_you" })]} loaded filtering={false} />, { container: document.body.appendChild(document.createElement("div")) });
    await flush();
    expect(screen.getByText(/asking you something/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText(/asking you something/)).toBeNull();
    expect(localStorage.getItem(TIPS_KEY)).toBe('["needs-you"]');
  });

  it("opens the Wefter Profile from the profile tip", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ game: { xp: 1 } }) })) as unknown as typeof fetch;
    render(<OnboardingTips cards={[makeCard({ column: "done" })]} loaded filtering={false} />, { container: document.body.appendChild(document.createElement("div")) });
    await flush();
    await userEvent.click(screen.getByRole("button", { name: "Open profile" }));
    await userEvent.click(await screen.findByRole("button", { name: "loom" }));
    expect(screen.queryByRole("button", { name: "loom" })).toBeNull();
    expect(localStorage.getItem(TIPS_KEY)).toBe('["profile"]');
  });

  it("draws no tip when its column isn't on the board", async () => {
    render(<OnboardingTips cards={[makeCard({ column: "review" })]} loaded filtering={false} />, { container: document.body.appendChild(document.createElement("div")) });
    await flush();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
