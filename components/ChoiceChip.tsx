"use client";

// A pressed-or-not choice in a row of chips (Settings → Laptop mode's durations and battery floor).
export default function ChoiceChip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-md border px-3 py-1.5 text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border-accent bg-accent-soft text-ink"
          : "border-line-strong text-muted hover:bg-sunken hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
