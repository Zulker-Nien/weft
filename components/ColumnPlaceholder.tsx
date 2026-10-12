import type { Column } from "@/lib/types";

// How many placeholder cards each column shows before the board's first load lands.
const SKELETONS: Record<Column, number> = { backlog: 2, running: 3, needs_you: 1, review: 2, done: 3 };

// Title bar widths, so the placeholder cards don't look stamped from one mold.
const WIDTHS = ["w-4/5", "w-3/5", "w-2/3", "w-1/2"];

const EMPTY_HINT: Record<Column, string> = {
  backlog: "New threads wait here until you start them",
  running: "Drag a backlog card here to start it",
  needs_you: "Cards land here when an agent asks for permission",
  review: "Cards land here when a turn finishes",
  done: "Drag reviewed threads here",
};

/**
 * What a column shows when it has no cards to draw: gray placeholder cards that hold its shape while
 * the card list loads, then a hint once it's loaded and empty.
 */
export default function ColumnPlaceholder({ column, loaded, empty, filtering }: { column: Column; loaded: boolean; empty: boolean; filtering: boolean }) {
  if (loaded) {
    if (!empty) return null;
    return <p className="px-2 py-3 text-center text-[11.5px] leading-snug text-faint">{filtering ? "No matching cards" : EMPTY_HINT[column]}</p>;
  }
  return (
    <>
      {Array.from({ length: SKELETONS[column] }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          data-testid="card-skeleton"
          style={{ animationDelay: `${i * 120}ms` }}
          className="animate-pulse rounded-lg border border-line bg-card px-3 py-2.5"
        >
          <div className={`h-3 rounded bg-sunken ${WIDTHS[i % WIDTHS.length]}`} />
          <div className="mt-2 h-2.5 w-full rounded bg-sunken" />
          <div className="mt-1.5 h-2.5 w-2/5 rounded bg-sunken" />
        </div>
      ))}
    </>
  );
}
