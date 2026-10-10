"use client";

import { useCallback, useEffect, useState } from "react";

// One toast message at a time; it clears itself after 5s. notify turns an error into a toast.
export function useToast() {
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((err: unknown) => {
    setToast(err instanceof Error ? err.message : String(err));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  return { toast, setToast, notify };
}
