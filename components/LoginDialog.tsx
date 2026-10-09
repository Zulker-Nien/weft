"use client";

import { useEffect, useEffectEvent, useRef, useState, type SubmitEvent } from "react";
import { api } from "@/lib/client";
import type { Backend, LoginView } from "@/lib/types";
import Icon, { Spinner } from "./Icon";
import { useEscape } from "@/lib/use-escape";

const NAMES: Record<Backend, string> = { claude: "Claude Code", puku: "puku-cli" };

// How long "Logged in" shows before the pop-up closes itself.
const DONE_MS = 2000;

type Action = "start" | "input" | "cancel" | "terminal";

const secondary =
  "rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-ink hover:bg-sunken disabled:opacity-50";
const primary =
  "inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-on-accent hover:opacity-90 disabled:opacity-50";

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function openUrl(url: string) {
  if (window.threadboard) window.threadboard.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

// The CLI's output, kept scrolled to the newest line.
function Output({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <pre
      ref={ref}
      className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-sunken px-3 py-2 font-mono text-[11px] leading-relaxed text-muted"
    >
      {text.trim() || "No output yet."}
    </pre>
  );
}

export default function LoginDialog({ login, onClose }: { login: LoginView; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = useEffectEvent(onClose);

  useEscape(true, onClose);

  // Done closes itself after a moment; a cancelled login has nothing left to show.
  useEffect(() => {
    if (login.state === "cancelled") {
      close();
      return;
    }
    if (login.state !== "done") return;
    const timer = setTimeout(() => close(), DONE_MS);
    return () => clearTimeout(timer);
  }, [login.state]);

  async function act(action: Action, text?: string) {
    setBusy(true);
    setError(null);
    try {
      await api.login(login.backend, action, text);
      return true;
    } catch (err) {
      setError(message(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!code.trim()) {
      setCodeError("Paste the code first.");
      return;
    }
    if (await act("input", code.trim())) setCode("");
  }

  async function cancel() {
    if (await act("cancel")) onClose();
  }

  if (login.state === "cancelled") return null;

  const name = NAMES[login.backend];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-dialog-title"
        className="w-full max-w-[520px] rounded-xl border border-line bg-panel shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id="login-dialog-title" className="text-[15px] font-medium text-ink">
            Log in to {name}
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          {login.state === "running" && (
            <>
              <div className="flex items-start gap-2.5 text-[13px] text-ink">
                <span className="mt-0.5 text-accent">
                  <Spinner />
                </span>
                <p>Finish signing in in your browser. This window closes when you&apos;re done.</p>
              </div>

              {login.url && (
                <div>
                  <button onClick={() => openUrl(login.url!)} className={primary}>
                    <Icon name="globe" size={14} /> Open login page
                  </button>
                </div>
              )}

              <form onSubmit={(e) => void sendCode(e)} className="flex flex-col gap-1.5">
                <label htmlFor="login-code" className="text-[12px] font-medium text-muted">
                  Paste a code from the login page
                </label>
                <div className="flex gap-2">
                  <input
                    id="login-code"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value);
                      setCodeError(null);
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Only if the CLI asks for one"
                    className="min-w-0 flex-1 rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-[13px] text-ink outline-none placeholder:font-sans placeholder:text-faint focus:border-accent"
                  />
                  <button type="submit" disabled={busy} className={`${secondary} inline-flex items-center gap-1.5`}>
                    <Icon name="send" size={13} /> Send
                  </button>
                </div>
                {codeError && <p className="text-[12.5px] text-danger">{codeError}</p>}
              </form>

              <details className="group">
                <summary className="cursor-pointer select-none text-[12px] font-medium text-muted hover:text-ink">
                  CLI output
                </summary>
                <div className="mt-2">
                  <Output text={login.output} />
                </div>
              </details>
            </>
          )}

          {login.state === "terminal" && (
            <div className="flex items-start gap-2.5 text-[13px] text-ink">
              <span className="mt-0.5 text-accent">
                <Spinner />
              </span>
              <p>Finish signing in in the Terminal window. This closes when you&apos;re logged in.</p>
            </div>
          )}

          {login.state === "done" && (
            <div className="flex items-center gap-2.5 text-[13px] text-ink">
              <Icon name="check" size={16} className="text-ok" />
              <p>Logged in. Retrying your thread…</p>
            </div>
          )}

          {login.state === "failed" && (
            <>
              <div className="flex items-start gap-2.5 text-[13px] text-ink">
                <Icon name="alert" size={16} className="mt-0.5 text-warn" />
                <p>Login didn&apos;t finish.</p>
              </div>
              <Output text={login.output} />
            </>
          )}

          {error && <p className="break-words text-[12.5px] text-danger">{error}</p>}
        </div>

        {login.state === "running" && (
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button onClick={() => void act("terminal")} disabled={busy} className={secondary}>
              Use Terminal instead
            </button>
            <button onClick={() => void cancel()} disabled={busy} className={secondary}>
              Cancel
            </button>
          </div>
        )}

        {login.state === "terminal" && (
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button onClick={() => void cancel()} disabled={busy} className={secondary}>
              Cancel
            </button>
          </div>
        )}

        {login.state === "failed" && (
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button onClick={onClose} className={secondary}>
              Close
            </button>
            <button onClick={() => void act("terminal")} disabled={busy} className={secondary}>
              Use Terminal instead
            </button>
            <button onClick={() => void act("start")} disabled={busy} className={primary}>
              <Icon name="reload" size={13} /> Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
