"use client";

// The client half of /admin/users. Wires <AdminTablePage> to /api/admin/users
// with the columns the SuperAdmin reads. The page (page.tsx) is a server
// component; the gate runs there, and this file just consumes the session
// the gate returned.
//
// <AdminTablePage> calls useResourceQuery as a hook (it has to: it returns
// state the page renders). The cleanest shape is a top-level function — no
// useRef, no useCallback wrapping — declared in this module and passed by
// reference. The function lives in a memo so re-renders don't reset state.

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AdminTablePage, idTailColumn, timestampColumn } from "@aimhuge/admin";
import type { SuperAdminSession } from "@aimhuge/admin/client";
import type { AdminUserRow } from "@/app/api/admin/users/route";

interface UsersClientProps {
  session: SuperAdminSession;
}

interface ApiResult {
  rows?: AdminUserRow[];
  total?: number;
  error?: string;
}

interface QueryState {
  rows: AdminUserRow[];
  total: number;
  isLoading: boolean;
  error: { message: string } | null;
}

const EMPTY: QueryState = { rows: [], total: 0, isLoading: true, error: null };

const columns: ColumnDef<AdminUserRow>[] = [
  {
    accessorKey: "email",
    header: "Email",
    cell: ({ getValue }) => {
      const v = getValue();
      return <span className="font-mono text-admin-text">{typeof v === "string" ? v : "—"}</span>;
    },
  },
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ getValue }) => {
      const v = getValue();
      return <span className="text-admin-text">{typeof v === "string" ? v : "—"}</span>;
    },
  },
  {
    accessorKey: "provider",
    header: "Provider",
    cell: ({ getValue }) => {
      const v = getValue();
      if (typeof v !== "string" || v === "") return "—";
      return <span className="rounded bg-admin-surface px-2 py-0.5 text-xs uppercase tracking-wide">{v}</span>;
    },
  },
  timestampColumn<AdminUserRow>({ field: "createdAt", label: "Joined" }),
  timestampColumn<AdminUserRow>({ field: "lastSignInAt", label: "Last seen" }),
  idTailColumn<AdminUserRow>({ accessorKey: "id" }),
];

// Top-level hook: the AdminTablePage contract. Owns its own state so the
// table renders even when the search/sort change between renders. The
// setState-on-mount is wrapped in a microtask to keep it out of the effect's
// synchronous render path (eslint: react-hooks/set-state-in-effect).
function useUsersQuery({ skip, take, searchTerm, sort }: { skip: number; take: number; searchTerm: string; sort: string }): QueryState {
  const [state, setState] = useState<QueryState>(EMPTY);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setState((s) => ({ ...s, isLoading: true }));
      const params = new URLSearchParams({ skip: String(skip), take: String(take), sort });
      if (searchTerm) params.set("q", searchTerm);
      fetch(`/api/admin/users?${params}`, { headers: { "x-threadboard": "1" } })
        .then(async (r) => {
          const data = (await r.json().catch(() => ({}))) as ApiResult;
          if (cancelled) return;
          if (!r.ok) {
            setState({ rows: [], total: 0, isLoading: false, error: { message: data.error ?? `HTTP ${r.status}` } });
          } else {
            setState({ rows: data.rows ?? [], total: data.total ?? 0, isLoading: false, error: null });
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setState({ rows: [], total: 0, isLoading: false, error: { message: err instanceof Error ? err.message : String(err) } });
        });
    };
    queueMicrotask(load);
    return () => {
      cancelled = true;
    };
  }, [skip, take, searchTerm, sort]);
  return state;
}

export default function UsersClient({ session }: UsersClientProps) {
  // useMemo so the reference is stable across renders (so <AdminTablePage>
  // doesn't re-mount when this component re-renders for unrelated reasons).
  const useResourceQuery = useMemo(() => useUsersQuery, []);
  return (
    <AdminTablePage<AdminUserRow>
      title="Weft users"
      resource="users"
      session={session}
      columns={columns}
      useResourceQuery={useResourceQuery}
      searchPlaceholder="email contains…"
      initialSort="created_at desc"
    />
  );
}
