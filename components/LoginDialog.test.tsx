// @vitest-environment jsdom
// Cancel on the login pop-up: the user must always be able to get out, even if
// the server is slow or the CLI is wedged. See components/LoginDialog.tsx.
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoginView } from "@/lib/types";
import LoginDialog from "./LoginDialog";

const api = vi.hoisted(() => ({
  login: vi.fn(),
}));
vi.mock("@/lib/client", () => ({ api }));
// The trial note pulls the Weft account, which isn't wired in jsdom.
vi.mock("@/lib/use-account", () => ({
  useAccount: () => ({ busy: null, waiting: null, error: null, signIn: vi.fn() }),
}));

function makeLogin(over: Partial<LoginView> = {}): LoginView {
  return { backend: "puku", state: "running", output: "Click here to sign in", startedAt: Date.now(), ...over };
}

function setup(login: LoginView = makeLogin()) {
  const onCloseSpy = vi.fn();
  // Real apps unmount the dialog on onClose; mirror that here so each test
  // starts from a clean DOM (testing-library's auto-cleanup is opt-in for
  // vitest@3, and the dialog's self-close fires after a microtask).
  const Wrapper = () => {
    const [open, setOpen] = useState(true);
    if (!open) {
      onCloseSpy();
      return null;
    }
    return <LoginDialog login={login} onClose={() => setOpen(false)} />;
  };
  render(<Wrapper />);
  return { onClose: onCloseSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.login.mockResolvedValue({ login: null });
});

// testing-library's auto-cleanup is opt-in for vitest@3; be explicit so a
// dialog left over from one test doesn't shadow the next one's button query.
afterEach(() => cleanup());

describe("LoginDialog", () => {
  it("Cancel calls api.login with the cancel action and an AbortSignal, then closes the dialog", async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.login).toHaveBeenCalledTimes(1);
    const call = api.login.mock.calls[0]!;
    expect(call[0]).toBe("puku");
    expect(call[1]).toBe("cancel");
    expect(call[3]).toBeInstanceOf(AbortSignal);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("Cancel closes the dialog when the server resolves cleanly", async () => {
    api.login.mockResolvedValue({ login: { backend: "puku", state: "cancelled" } });
    const { onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("Cancel closes the dialog even when the server never responds (the original bug)", async () => {
    // The bug: the CLI is wedged, the server's POST hangs, the dialog never
    // closes. The fix: cancel fires the server request with an AbortSignal and
    // closes the dialog immediately, so a stuck server can't trap the user.
    api.login.mockImplementation(() => new Promise(() => {}));

    const { onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // Closed on the click, not on the server's response.
    expect(onClose).toHaveBeenCalledTimes(1);
    // The signal we passed in was a real AbortSignal; the unmount cleanup will
    // abort it so the hanging request unblocks.
    const signal = api.login.mock.calls[0]![3] as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("a 'cancelled' state closes the dialog without the user clicking anything", async () => {
    const { onClose } = setup(makeLogin({ state: "cancelled" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("Cancel is re-clickable while a request is in flight (no busy lock)", async () => {
    api.login.mockImplementation(() => new Promise(() => {}));
    setup();
    const button: HTMLButtonElement = screen.getByRole("button", { name: "Cancel" });
    expect(button.disabled).toBe(false);
    await userEvent.click(button);
    expect(button.disabled).toBe(false);
  });
});
