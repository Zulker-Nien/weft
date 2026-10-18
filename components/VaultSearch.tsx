"use client";

import Icon from "./Icon";

// The 🔐 drawer's search box (lib/vault-search.ts): narrows every shown vault to the secrets whose name or
// hint holds the query. Escape clears it first, and only an empty box lets Escape reach the drawer.
export default function VaultSearch({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  return (
    <label className="mx-3 mt-2 flex items-center gap-1.5 rounded-md border border-line-strong bg-card px-1.5 py-0.5 text-muted focus-within:border-accent/60">
      <Icon name="search" size={11} />
      <input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && query) {
            e.stopPropagation();
            onQuery("");
          }
        }}
        placeholder="Filter secrets"
        aria-label="Filter secrets"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-[11.5px] text-ink outline-none placeholder:text-faint"
      />
    </label>
  );
}
