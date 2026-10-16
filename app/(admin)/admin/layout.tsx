// Layout for /admin/users and /admin/settings. The body is full-screen
// (the root layout is overflow-hidden and would clip the table), so we let
// the admin pages scroll naturally. The page itself calls
// `requireSuperAdminWeft`, which short-circuits with notFound() for
// non-admins — a 404 leaks less than a 403 (it doesn't confirm the route
// exists).
//
// A small top bar with a "← Board" link sits above the page so the SuperAdmin
// can return to the board without using the browser back button (which on
// the deployed weft.zip would walk into the marketing site instead).
import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-root flex h-full min-h-0 flex-col overflow-auto bg-canvas text-ink">
      <header className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2 text-[12px] text-muted">
        <Link href="/" className="rounded-md border border-line bg-canvas px-2 py-0.5 text-ink hover:bg-sunken" title="Back to the board">
          ← Board
        </Link>
        <Link href="/admin/users" className="hover:text-ink" title="Weft users (auth.users)">Users</Link>
        <span className="text-faint" aria-hidden>·</span>
        <Link href="/admin/settings" className="hover:text-ink" title="Local install overview">Settings</Link>
        <span className="ml-auto text-faint">SuperAdmin</span>
      </header>
      {children}
    </div>
  );
}
