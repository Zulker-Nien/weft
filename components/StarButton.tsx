"use client";

// The ☆ that files a card in the library (lib/card-menu.ts starMenu): on a card it shows on hover, in a
// thread's header always. Starred, it's a ★ that always shows and opens Show in Library and Unstar.
// No onClick, no button.
export default function StarButton({
  starred,
  onClick,
  variant,
}: {
  starred: boolean;
  onClick?: (e: React.MouseEvent) => void;
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
        onClick(e);
      }}
      title={starred ? "Starred: show it in your library, or unstar it" : "Star: keep it in your library as a recipe, to-do or note"}
      aria-label={starred ? "Starred" : "Star"}
      className={`hover:bg-sunken ${size} ${tone}`}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}
