"use client";

import { useEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import CrashGuard, { type CrashGuardProps } from "./CrashGuard";

// A CrashGuard only catches what throws while drawing. A module that throws while it loads (a thread wrote
// `<BlastcpLogo />` into a constant before its import) fails every file that imports it, up to the whole board.
// guarded() loads the component with import() instead, so that failure lands in the component's own CrashGuard
// as well, and Try again imports it afresh. The import starts as soon as the importing module runs, and once
// loaded the component draws on its first render, so opening a thread or a dialog doesn't flash.
type Loader<P> = () => Promise<{ default: ComponentType<P> }>;
type Guard = Omit<CrashGuardProps, "name"> & {
  /** Drawn while the module loads (the first time only); nothing by default. */
  placeholder?: ReactNode;
};

export function guarded<P extends object>(load: Loader<P>, guard: Guard): ComponentType<P & { guardName?: string }> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function start() {
    pending ??= load().then(
      (mod) => {
        loaded = mod.default;
        listeners.forEach((fn) => fn());
      },
      (err: unknown) => {
        // Forget the failure, so Try again (a remount) imports the module again.
        pending = null;
        throw err;
      },
    );
    return pending;
  }
  if (typeof window !== "undefined") start().catch(() => {});

  const { placeholder, ...crash } = guard;
  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  function Loaded(props: P) {
    // The server never loads it, so hydration starts from the placeholder like the server's HTML did.
    const Component = useSyncExternalStore(subscribe, () => loaded, () => null);
    const [error, setError] = useState<Error | null>(null);
    useEffect(() => {
      if (!loaded) start().catch((err: unknown) => setError(err instanceof Error ? err : new Error(String(err))));
    }, []);
    if (error) throw error;
    return Component ? <Component {...props} /> : (placeholder ?? null);
  }

  function Guarded({ guardName, ...props }: P & { guardName?: string }) {
    // A dialog or drawer's own onClose doubles as the fallback's Close.
    const { onClose } = props as { onClose?: () => void };
    return (
      <CrashGuard {...crash} name={guardName} onClose={onClose}>
        <Loaded {...(props as P)} />
      </CrashGuard>
    );
  }
  Guarded.displayName = `guarded(${guard.what})`;
  return Guarded;
}
