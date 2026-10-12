import type { AccountUser } from "@/lib/types";

// Your Weft account picture from GitHub or Google, or your first initial on a tinted circle.
export default function Avatar({ user, size }: { user: AccountUser; size: number }) {
  const style = { width: size, height: size };
  if (user.avatar) return <img src={user.avatar} alt="" style={style} className="shrink-0 rounded-full" />;
  return (
    <span
      style={{ ...style, fontSize: Math.round(size * 0.45) }}
      className="flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-medium text-accent"
    >
      {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
}
