"use client";

import { useEffect, useState } from "react";

// Returns true when the signed-in Weft account is on SUPER_ADMIN_EMAILS.
// Re-evaluates when the account changes (sign in, sign out) via the same
// `weft:account` window event the rest of the board listens for.
export function useSuperAdminGate(): boolean {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/admin/gate", { headers: { "x-threadboard": "1" } })
        .then((r) => (r.ok ? r.json() : { admin: false }))
        .then((data: { admin: unknown }) => {
          if (!cancelled) setAdmin(data.admin === true);
        })
        .catch(() => {
          if (!cancelled) setAdmin(false);
        });
    void load();
    const reload = () => void load();
    window.addEventListener("weft:account", reload);
    return () => {
      cancelled = true;
      window.removeEventListener("weft:account", reload);
    };
  }, []);
  return admin;
}
