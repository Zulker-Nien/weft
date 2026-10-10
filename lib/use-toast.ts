"use client";

import { useCallback, useEffect, useState } from "react";

// A button on the toast, like Undo.
export type ToastAction = { label: string; run: () => void };

type Toast = { text: string; action?: ToastAction };

// One toast message at a time; it clears itself after 5s. notify turns an error into a toast.
export function useToast() {
  const [toast, setToastState] = useState<Toast | null>(null);

  const setToast = useCallback((text: string | null, action?: ToastAction) => {
    setToastState(text === null ? null : { text, action });
  }, []);

  const notify = useCallback((err: unknown) => {
    setToastState({ text: err instanceof Error ? err.message : String(err) });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToastState(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  return { toast, setToast, notify };
}
