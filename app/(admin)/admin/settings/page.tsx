// /admin/settings — the local install's snapshot for the SuperAdmin to eyeball.
// All data is local (no Supabase call), so the page is fully server-rendered.
// Gate: `requireSuperAdminWeft()` throws notFound() for non-admins.
import type { Metadata } from "next";
import { connection } from "next/server";
import { requireSuperAdminWeft } from "@/lib/admin";
import { loadAdminLocalOverview } from "@/app/api/admin/local/route";

export const metadata: Metadata = { title: "Weft admin — Settings" };

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-admin-border bg-admin-surface px-3 py-2 text-sm">
      <div className="text-xs text-admin-muted">{label}</div>
      <div className="font-mono text-admin-text">{value}</div>
    </div>
  );
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatMs(n: number) {
  if (n < 60) return `${n}s`;
  if (n < 60 * 60) return `${Math.round(n / 60)}m`;
  return `${Math.round(n / 3600)}h`;
}

export default async function AdminSettingsPage() {
  const { user } = await requireSuperAdminWeft();
  // Mark the page dynamic so Next doesn't try to prerender it at build time.
  await connection();
  const data = loadAdminLocalOverview();

  return (
    <div className="flex flex-col gap-4 p-4 text-admin-text">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-admin-text">Local Weft install</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-admin-border bg-admin-surface px-3 py-2 text-xs">
          <strong className="text-admin-accent">SuperAdmin</strong>
          <span className="inline-flex items-center gap-1">
            <strong className="text-admin-muted">Name:</strong>
            <span className="font-mono">{user.name ?? "—"}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <strong className="text-admin-muted">Email:</strong>
            <span className="font-mono">{user.email ?? "—"}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <strong className="text-admin-muted">UserId:</strong>
            <span className="font-mono">{user.id.slice(-5) || "—"}</span>
          </span>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Data dir" value={data.dataDir} />
        <Stat label="Weft version" value={data.version} />
        <Stat label="Process uptime" value={formatMs(data.uptime)} />
        <Stat label="Cards on board" value={`${data.board.cards}`} />
        <Stat label="Archived cards" value={`${data.board.archived}`} />
        <Stat label="Thread files" value={`${data.board.threads}`} />
        <Stat label="Activity entries" value={`${data.activity.entries}`} />
        <Stat
          label="Last activity"
          value={data.activity.lastAt ? new Date(data.activity.lastAt).toLocaleString() : "—"}
        />
        <Stat label="Stored pages" value={`${data.pages.count} (${formatBytes(data.pages.bytes)})`} />
        <Stat
          label="Keep-alive minutes"
          value={data.settings.maxKeepAliveMinutes === null ? "—" : `${data.settings.maxKeepAliveMinutes}`}
        />
      </section>

      <section className="text-xs text-admin-muted">
        For deeper diagnostics, see <code className="font-mono text-admin-text">~/.weft/</code>{" "}
        on this machine. Activity writes through <code className="font-mono">~/.weft/activity.jsonl</code>.
      </section>
    </div>
  );
}

