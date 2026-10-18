"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { answerFor, answerWelcome, defaultTicks, loadWelcome, REPLAY_EVENT, TEST_EVENT, type WelcomePreview } from "@/lib/welcome-client";
import Modal from "./Modal";
import { AboutStep, BoardStep, RailStep } from "./WelcomeIntro";
import { ProfileStep, ProjectsStep } from "./WelcomeSteps";

// First launch's welcome, for everyone (lib/welcome.ts): screens 1 to 3 explain Weft, its board and the left bar (Back / Next),
// screen 4 shows the Wefter Profile your Claude Code history makes (Opt out / OK), screen 5 the projects to bring in (Start fresh / OK). OK is the
// default on ↵. The session sync adds no cards until it's answered; with no sessions at all there's
// nothing to ask, so it answers itself. Settings → General's "Replay the welcome" shows it again as a
// preview that changes nothing (its switches do that); its "Test it" shows the real one, answered for real. It draws over the rest of the window, Settings too.
const STEPS = 5;
type Step = 1 | 2 | 3 | 4 | 5;

export default function WelcomeDialog({ onError }: { onError?: (err: unknown) => void }) {
  const [preview, setPreview] = useState<WelcomePreview | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [countHistory, setCountHistory] = useState(true);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [replay, setReplay] = useState(false);
  const ok = useRef<HTMLButtonElement>(null);
  // The board hands a new onError on every render; the loading effect shouldn't rerun for that.
  const report = useRef(onError);
  useEffect(() => {
    report.current = onError;
  });

  useEffect(() => {
    let live = true;
    const load = () =>
      void loadWelcome()
        .then((view) => {
          if (!live || view.welcome || !view.preview) return;
          if (!view.preview.projects.length) return void answerWelcome({ countHistory: true, fresh: false, skip: [] }).catch(() => {});
          setReplay(false);
          setStep(1);
          setPreview(view.preview);
          setTicked(defaultTicks(view.preview.projects));
        })
        .catch(() => {});
    load();
    const onReplay = () =>
      void loadWelcome(true)
        .then((view) => {
          if (!live || !view.preview) return;
          setReplay(true);
          setStep(1);
          setPreview(view.preview);
          setTicked(defaultTicks(view.preview.projects));
        })
        .catch((err: unknown) => report.current?.(err));
    window.addEventListener(REPLAY_EVENT, onReplay);
    window.addEventListener(TEST_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(REPLAY_EVENT, onReplay);
      window.removeEventListener(TEST_EVENT, load);
    };
  }, []);

  useEffect(() => ok.current?.focus(), [preview, step]);

  if (!preview) return null;

  const finish = (fresh: boolean) => {
    if (replay) {
      setPreview(null);
      return;
    }
    setBusy(true);
    answerWelcome(answerFor(countHistory, preview.projects, ticked, fresh))
      .then(() => setPreview(null))
      .catch((err: unknown) => {
        setBusy(false);
        report.current?.(err);
      });
  };
  const first = (count: boolean) => {
    setCountHistory(count);
    setStep(5);
  };
  const toggle = (cwd: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });
  // ↵ is OK wherever focus is (a ticked box too), except on another button, which presses itself.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || (e.target as HTMLElement).tagName === "BUTTON") return;
    e.preventDefault();
    ok.current?.click();
  };

  const button = "rounded-md border border-line px-3 py-1.5 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-40";
  const primary = "rounded-md bg-accent px-4 py-1.5 text-[12.5px] font-semibold text-on-accent ring-2 ring-accent/30 disabled:opacity-40";
  return createPortal(
    <Modal label="Welcome to Weft" onClose={() => {}} keepOnBackdrop className="w-full max-w-[620px]">
      <div onKeyDown={onKeyDown} className="flex flex-col">
        <div className="flex items-center justify-between border-b border-line px-5 py-2.5 text-[12px] text-muted">
          <span>{replay ? "Welcome to Weft · replay, nothing changes" : "Welcome to Weft"}</span>
          <span className="flex gap-1.5" aria-label={`Step ${step} of ${STEPS}`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className={`size-1.5 rounded-full ${step === n ? "bg-accent" : "bg-line"}`} />
            ))}
          </span>
        </div>
        <div className="max-h-[70vh] overflow-auto px-5 py-4">
          {step === 1 && <AboutStep />}
          {step === 2 && <BoardStep />}
          {step === 3 && <RailStep />}
          {step === 4 && <ProfileStep preview={preview} />}
          {step === 5 && <ProjectsStep projects={preview.projects} ticked={ticked} toggle={toggle} />}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-5 py-3">
          <span className="flex-1 text-[11.5px] text-muted">
            {step < 4 ? "Replay this any time from Settings → General." : step === 4 ? "Change it any time in Settings → General." : "Start fresh leaves your old sessions off the board. Bring them in later from Settings."}
          </span>
          {step < 4 ? (
            <span className="flex shrink-0 gap-2">
              {step > 1 && (
                <button type="button" className={button} onClick={() => setStep((step - 1) as Step)}>
                  Back
                </button>
              )}
              <button type="button" ref={ok} className={primary} onClick={() => setStep((step + 1) as Step)}>
                Next ↵
              </button>
            </span>
          ) : step === 4 ? (
            <span className="flex shrink-0 gap-2">
              <button type="button" className={button} onClick={() => first(false)}>
                Opt out
              </button>
              <button type="button" ref={ok} className={primary} onClick={() => first(true)}>
                OK ↵
              </button>
            </span>
          ) : (
            <span className="flex shrink-0 gap-2">
              <button type="button" className={button} disabled={busy} onClick={() => finish(true)}>
                Start fresh
              </button>
              <button type="button" ref={ok} className={primary} disabled={busy} onClick={() => finish(false)}>
                OK ↵
              </button>
            </span>
          )}
        </div>
      </div>
    </Modal>,
    document.body,
  );
}
