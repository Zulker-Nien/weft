// @vitest-environment jsdom
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EditorView } from "@tiptap/pm/view";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import SecretPasteBar, { removeFromEditor, useSecretPaste, type SecretPasteGuard } from "./SecretPaste";
import Composer from "./Composer";

vi.mock("@/lib/client", () => ({ api: { skills: vi.fn(() => Promise.resolve({ skills: [] })) } }));

// Built up here so the file itself never holds a whole key for a scanner to flag.
const STRIPE_KEY = "sk_live_" + "51HxAbCdEfGhIjKlMnOpQrSt";
const GITHUB_TOKEN = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";

// The guard wired the way Composer's Markdown view wires it: a textarea whose paste the guard may hold,
// and a bar whose "Paste anyway" puts the text back in. `guardOut` hands the guard to tests that drive it directly.
function Harness({ onPaste, guardOut }: { onPaste?: (text: string) => void; guardOut?: (g: SecretPasteGuard) => void }) {
  const guard = useSecretPaste();
  const [value, setValue] = useState("");
  guardOut?.(guard);
  return (
    <div>
      <textarea
        aria-label="Message"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPaste={(e) => {
          if (guard.hold(e.clipboardData.getData("text/plain"))) e.preventDefault();
        }}
      />
      <SecretPasteBar
        guard={guard}
        onPaste={(text) => {
          onPaste?.(text);
          setValue((v) => v + text);
        }}
      />
    </div>
  );
}

function setup() {
  const onPaste = vi.fn<(text: string) => void>();
  let guard!: SecretPasteGuard;
  render(<Harness onPaste={onPaste} guardOut={(g) => (guard = g)} />);
  return { onPaste, guard: () => guard, box: screen.getByRole("textbox", { name: "Message" }) };
}

async function pasteInto(box: HTMLElement, text: string) {
  await userEvent.click(box);
  await userEvent.paste(text);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SecretPasteBar", () => {
  it("holds a pasted key back and names what it looks like, masked", async () => {
    const { box, onPaste } = setup();
    await pasteInto(box, STRIPE_KEY);
    const bar = screen.getByRole("alert");
    expect(bar).toHaveTextContent("That looks like a Stripe secret key (sk_live_…QrSt)");
    // The key isn't in the box, and the whole key isn't anywhere on screen.
    expect(box).toHaveValue("");
    expect(document.body).not.toHaveTextContent(STRIPE_KEY);
    expect(onPaste).not.toHaveBeenCalled();
  });

  it("holds a GitHub token pasted in the middle of a sentence", async () => {
    const { box } = setup();
    await pasteInto(box, `use ${GITHUB_TOKEN} for the API`);
    expect(screen.getByRole("alert")).toHaveTextContent("That looks like a GitHub token");
    expect(box).toHaveValue("");
  });

  it("holds a .env line with a secret-sounding name", async () => {
    const { box } = setup();
    await pasteInto(box, "DATABASE_PASSWORD=hunter2hunter2");
    expect(screen.getByRole("alert")).toHaveTextContent("That looks like a secret (DATABASE_PASSWORD)");
  });

  it("lets ordinary text, code and placeholder .env lines straight through", async () => {
    const { box } = setup();
    await pasteInto(box, "Fix the login page");
    await userEvent.paste(" const key = process.env.STRIPE_KEY;");
    await userEvent.paste(" API_KEY=your-key-here");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(box).toHaveValue("Fix the login page const key = process.env.STRIPE_KEY; API_KEY=your-key-here");
  });

  it("Paste anyway hands the held text over and closes the bar", async () => {
    const { box, onPaste } = setup();
    await pasteInto(box, STRIPE_KEY);
    await userEvent.click(screen.getByRole("button", { name: "Paste anyway" }));
    expect(onPaste).toHaveBeenCalledExactlyOnceWith(STRIPE_KEY);
    expect(box).toHaveValue(STRIPE_KEY);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Don't paste drops the text and closes the bar", async () => {
    const { box, onPaste } = setup();
    await pasteInto(box, STRIPE_KEY);
    await userEvent.click(screen.getByRole("button", { name: "Don't paste" }));
    expect(onPaste).not.toHaveBeenCalled();
    expect(box).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a second key replaces the first one waiting in the bar", async () => {
    const { box, onPaste } = setup();
    await pasteInto(box, STRIPE_KEY);
    await userEvent.paste(GITHUB_TOKEN);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("a GitHub token");
    await userEvent.click(screen.getByRole("button", { name: "Paste anyway" }));
    expect(onPaste).toHaveBeenCalledExactlyOnceWith(GITHUB_TOKEN);
  });
});

describe("useSecretPaste().pasteInto", () => {
  // The rich editor's paste handler asks the guard again when "Paste anyway" replays the text into it,
  // so the replay must get through or the bar would come straight back.
  it("replays the paste into the editor past the guard, then focuses it", () => {
    const { guard } = setup();
    let heldDuringReplay: boolean | undefined;
    const view = {
      pasteText: vi.fn(() => {
        heldDuringReplay = guard().hold(STRIPE_KEY);
      }),
      focus: vi.fn(),
    };
    guard().pasteInto(view as unknown as EditorView, STRIPE_KEY);
    expect(view.pasteText).toHaveBeenCalledWith(STRIPE_KEY);
    expect(heldDuringReplay).toBe(false);
    expect(view.focus).toHaveBeenCalled();
    // Once the replay is over the guard holds keys again.
    let heldAfter = false;
    act(() => {
      heldAfter = guard().hold(STRIPE_KEY);
    });
    expect(heldAfter).toBe(true);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("does nothing before the editor exists", () => {
    const { guard } = setup();
    expect(() => guard().pasteInto(undefined, STRIPE_KEY)).not.toThrow();
  });
});

// The real Composer. Its rich editor is TipTap, which jsdom can't paste into (ProseMirror reads the
// clipboard through its own DOM handlers), so this goes through the "Edit as Markdown" view, a plain
// textarea that shares the same guard and bar.
describe("Composer's paste guard (Markdown view)", () => {
  async function markdownView() {
    const onChange = vi.fn<(markdown: string) => void>();
    render(<Composer variant="reply" placeholder="Reply" sizeClass="" onSubmit={() => {}} onChange={onChange} />);
    const toggle = screen.getByRole("button", { name: "Edit as Markdown" });
    await waitFor(() => expect(toggle).toBeEnabled());
    await userEvent.click(toggle);
    return { onChange, box: await screen.findByRole("textbox", { name: "Markdown" }) };
  }

  it("holds a key pasted into the Markdown view", async () => {
    const { box, onChange } = await markdownView();
    await pasteInto(box, STRIPE_KEY);
    expect(screen.getByRole("alert")).toHaveTextContent("a Stripe secret key");
    expect(box).toHaveValue("");
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining(STRIPE_KEY));
  });

  it("Paste anyway puts the key into the Markdown view", async () => {
    const { box, onChange } = await markdownView();
    await pasteInto(box, STRIPE_KEY);
    await userEvent.click(screen.getByRole("button", { name: "Paste anyway" }));
    expect(box).toHaveValue(STRIPE_KEY);
    expect(onChange).toHaveBeenLastCalledWith(STRIPE_KEY);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Don't paste leaves the Markdown view as it was", async () => {
    const { box } = await markdownView();
    await pasteInto(box, "Deploy with ");
    await userEvent.paste(STRIPE_KEY);
    await userEvent.click(screen.getByRole("button", { name: "Don't paste" }));
    expect(box).toHaveValue("Deploy with ");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ordinary text pastes into the Markdown view as usual", async () => {
    const { box } = await markdownView();
    await pasteInto(box, "Fix the login page");
    expect(box).toHaveValue("Fix the login page");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Composer's typed-secret check (Markdown view)", () => {
  async function typedIn(text: string) {
    const onChange = vi.fn<(markdown: string) => void>();
    render(<Composer variant="reply" placeholder="Reply" sizeClass="" onSubmit={() => {}} onChange={onChange} />);
    const toggle = screen.getByRole("button", { name: "Edit as Markdown" });
    await waitFor(() => expect(toggle).toBeEnabled());
    await userEvent.click(toggle);
    const box = await screen.findByRole("textbox", { name: "Markdown" });
    // Typed, dictated or dropped: it arrives as a change, not a paste.
    fireEvent.change(box, { target: { value: text } });
    return { box, onChange };
  }

  it("flags a key that arrives without a paste, and Remove it takes just the key out", async () => {
    const { box, onChange } = await typedIn(`use ${STRIPE_KEY} for billing`);
    expect(await screen.findByRole("alert")).toHaveTextContent("a Stripe secret key");
    await userEvent.click(screen.getByRole("button", { name: "Remove it" }));
    expect(box).toHaveValue("use  for billing");
    expect(onChange).toHaveBeenLastCalledWith("use  for billing");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("Keep it lets that key stay, but a different one is flagged again", async () => {
    const { box } = await typedIn(STRIPE_KEY);
    await userEvent.click(await screen.findByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(box).toHaveValue(STRIPE_KEY);
    fireEvent.change(box, { target: { value: `${STRIPE_KEY} ${GITHUB_TOKEN}` } });
    expect(await screen.findByRole("alert")).toHaveTextContent("a GitHub token");
  });

  it("says nothing about ordinary text", async () => {
    await typedIn("Fix the login page, the key is in the vault");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("removeFromEditor", () => {
  function fakeEditor(texts: string[]) {
    const run = vi.fn();
    const deleteRange = vi.fn(() => ({ run }));
    const editor = {
      state: {
        doc: {
          descendants: (fn: (node: { isText: boolean; text?: string }, pos: number) => boolean) => {
            let pos = 1;
            for (const text of texts) {
              if (!fn({ isText: false }, pos - 1)) return;
              if (!fn({ isText: true, text }, pos)) return;
              pos += text.length + 2;
            }
          },
        },
      },
      chain: () => ({ focus: () => ({ deleteRange }) }),
    };
    return { editor: editor as never, deleteRange, run };
  }

  it("deletes the first run of text holding the value", () => {
    const { editor, deleteRange, run } = fakeEditor(["hello", `key ${STRIPE_KEY} here`, STRIPE_KEY]);
    removeFromEditor(editor, STRIPE_KEY);
    expect(deleteRange).toHaveBeenCalledWith({ from: 8 + 4, to: 8 + 4 + STRIPE_KEY.length });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the value isn't in one run of text, or there's no editor", () => {
    const { editor, deleteRange } = fakeEditor(["sk_live_", "split"]);
    removeFromEditor(editor, STRIPE_KEY);
    removeFromEditor(null, STRIPE_KEY);
    expect(deleteRange).not.toHaveBeenCalled();
  });
});
