"use client";

// The ☆ that stars a card: on a card it shows on hover, in a thread's header always. Starred, it's a ★
// that always shows, and a click unstars it. A starred card is never auto-archived. No onClick, no button.
export default function StarButton({
  starred,
  onClick,
  variant,
}: {
  starred: boolean;
  onClick?: () => void;
  variant: "card" | "header";
}) {
  if (!onClick) return null;
  const size = variant === "header" ? "rounded-md px-1.5 py-0.5 text-[16px] leading-none" : "-my-1 shrink-0 rounded px-1 text-[13px] leading-5";
  // On a card, ☆ waits for the pointer so it doesn't add to every card at rest.
  const tone = starred ? "text-warn" : variant === "card" ? "text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-warn" : "text-muted hover:text-warn";
  return (
    <button
      onClick={(e) => {
        // It sits inside a card, whose own click opens the thread.
        e.stopPropagation();
        onClick();
      }}
      title={starred ? "Starred: click to unstar" : "Star: keep it, never auto-archived"}
      aria-label={starred ? "Starred" : "Star"}
      className={`hover:bg-sunken ${size} ${tone}`}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}
