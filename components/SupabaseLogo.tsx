// Supabase's bolt, in its green: the rail button, the drawer header and a linked project's name.
export default function SupabaseLogo({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 109 113" width={size} height={size} className="inline-block shrink-0 align-[-2px]" aria-hidden>
      <path d="M63.708 110.284c-2.86 3.601-8.658 1.628-8.727-2.97l-1.007-67.251h45.22c8.19 0 12.758 9.46 7.665 15.874l-43.151 54.347Z" fill="#249361" />
      <path d="M45.317 2.071c2.86-3.601 8.657-1.628 8.726 2.97l.442 67.251H9.83c-8.19 0-12.759-9.46-7.665-15.875L45.317 2.072Z" fill="#3ECF8E" />
    </svg>
  );
}
