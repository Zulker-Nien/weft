"use client";

// The open card's share, star and archive in the browser pane's toolbar (components/BrowserPane.tsx `actions`),
// so the thread header keeps only its title, skills and delete. The copilot has none of them.
import { isLive } from "@/lib/format";
import { CardMarks, type CardMarkProps } from "./CardActions";

export default function PaneCardMarks(props: Omit<CardMarkProps, "live">) {
  if (props.card.role === "copilot") return null;
  return (
    <span className="flex items-center gap-0.5 border-l border-line pl-1">
      <CardMarks {...props} live={isLive(props.card)} />
    </span>
  );
}
