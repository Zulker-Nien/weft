"use client";

import { useState } from "react";
import { useBuildError } from "@/lib/build-error";
import Icon from "./Icon";

// Stands in for Next's Build Error overlay (lib/build-error.ts): the board behind it is the last version that
// compiled and still works, so say which file broke and get out of the way.
export default function BuildErrorBar() {
  const error = useBuildError();
  const [open, setOpen] = useState(false);
  if (!error) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-16 left-4 z-50 flex max-w-md flex-col gap-1.5 rounded-lg border border-danger/40 bg-panel px-3.5 py-2.5 text-[12.5px] text-ink shadow-lg"
    >
      <div className="flex items-start gap-2">
        <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-danger" />
        <span className="flex-1">
          Build error{error.file && <> in <span className="font-mono text-[11.5px]">{error.file}</span></>}. You&apos;re on
          the last version that built; it updates once the file is fixed.
        </span>
        <button onClick={() => setOpen(!open)} className="shrink-0 font-medium text-accent hover:underline">
          {open ? "Hide" : "Details"}
        </button>
      </div>
      {open && (
        <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded bg-sunken p-2 font-mono text-[11px]">
          {error.message}
        </pre>
      )}
    </div>
  );
}
