import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { tagColors, tagList, type TagInfo } from "@/lib/rail-view";
import type { Card } from "@/lib/types";

// The tag catalog (app/api/tags, lib/tag-store.ts) merged with the board's cards: every tag with its colour
// and count, and the calls that create, rename, recolour and delete one. Renaming and deleting rewrite every
// card on the server, which publishes them, so the board's cards follow on their own.
export function useTagCatalog(cards: readonly Card[], notify: (err: unknown) => void) {
  const [catalog, setCatalog] = useState<Omit<TagInfo, "count">[] | null>(null);
  // A new tag on a card joins the catalog on the server, so reload when the board's set of tags changes.
  const onCards = [...new Set(cards.flatMap((c) => c.tags ?? []))].sort().join("\n");

  const reload = useCallback(() => {
    api
      .tags()
      .then(({ tags }) => setCatalog(tags))
      .catch(() => {});
  }, []);

  useEffect(reload, [reload, onCards]);

  const tags = useMemo(() => tagList(catalog, cards), [catalog, cards]);
  const colors = useMemo(() => tagColors(tags), [tags]);

  const run = (call: Promise<unknown>) => call.then(reload, notify);

  return {
    tags,
    colors,
    create: (name: string, color?: string) => run(api.createTag(name, color)),
    rename: (name: string, to: string) => run(api.updateTag(name, { rename: to })),
    recolor: (name: string, color: string) => run(api.updateTag(name, { color })),
    remove: (name: string) => run(api.deleteTag(name)),
  };
}

export type TagCatalog = ReturnType<typeof useTagCatalog>;
