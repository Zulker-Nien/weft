// The rail's ★ and tag filter, shown beside the filter box so it's clear why cards are missing: one click clears each.
import Icon from "./Icon";
import { isFiltering, type RailFilter } from "@/lib/rail-view";

export default function RailFilterChip({ filter, onClear }: { filter: RailFilter; onClear: (filter: RailFilter) => void }) {
  if (!isFiltering(filter)) return null;
  const chip = "flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent hover:opacity-80";
  return (
    <>
      {filter.starred && (
        <button onClick={() => onClear({ ...filter, starred: undefined })} title="Show every card, not just starred ones" className={chip}>
          ★ starred <Icon name="x" size={10} />
        </button>
      )}
      {filter.tag && (
        <button onClick={() => onClear({ ...filter, tag: undefined })} title={`Show every card, not just #${filter.tag}`} className={`${chip} max-w-[140px]`}>
          <span className="truncate">#{filter.tag}</span> <Icon name="x" size={10} />
        </button>
      )}
    </>
  );
}

