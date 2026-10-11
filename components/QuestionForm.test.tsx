// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Question } from "@/lib/types";
import QuestionForm from "./QuestionForm";

afterEach(cleanup);

const QUESTIONS: Question[] = [
  { question: "Which sign-in methods?", header: "Providers", multiSelect: true, options: [{ label: "GitHub", description: "" }, { label: "Google", description: "" }] },
  { question: "Required?", header: "Required?", multiSelect: false, options: [{ label: "Optional", description: "" }, { label: "Required", description: "" }] },
];

function setup() {
  const onAnswer = vi.fn();
  const onSkip = vi.fn();
  render(<QuestionForm questions={QUESTIONS} onAnswer={onAnswer} onSkip={onSkip} />);
  return { onAnswer, onSkip };
}

describe("QuestionForm", () => {
  it("scrolls the questions but keeps the buttons outside the scroll area", () => {
    setup();
    const scroll = screen.getByText("Which sign-in methods?").closest(".overflow-y-auto");
    expect(scroll).not.toBeNull();
    expect(scroll!.contains(screen.getByText("Required?", { selector: "div" }))).toBe(true);
    expect(scroll!.contains(screen.getByRole("button", { name: "Send answer" }))).toBe(false);
    expect(scroll!.contains(screen.getByRole("button", { name: "Skip" }))).toBe(false);
  });

  it("asks for every question before sending, then sends the picks", async () => {
    const { onAnswer } = setup();
    await userEvent.click(screen.getByRole("button", { name: /GitHub/ }));
    await userEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(screen.getByText("Answer “Required?” first.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Google/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Optional/ }));
    await userEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(onAnswer).toHaveBeenCalledWith({ "Which sign-in methods?": "GitHub, Google", "Required?": "Optional" });
  });
});
