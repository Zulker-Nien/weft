"use client";

// A plain icon under the left rail's divider that opens its drawer: ▲ Vercel, Supabase's bolt, Cloudflare's cloud, BlastCP's rocket, GitHub's mark. 🔐 has its own,
// with badges (components/LibraryRail.tsx).
export default function RailIconButton({ icon, label, open, title, onClick }: { icon: React.ReactNode; label: string; open: boolean; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={open}
      className={`grid size-7 place-items-center rounded-md text-[13px] ${open ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"}`}
    >
      <span aria-hidden>{icon}</span>
      <span className="sr-only">{label}</span>
    </button>
  );
}
