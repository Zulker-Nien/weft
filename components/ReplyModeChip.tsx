// The reply box's mode, named at the top inside its frame ("Queue · after this turn", "Shell · weft", "Replace last
// message · Esc"), and the frame's colour for it. A plain reply has no chip (lib/reply-mode.ts leaves chip out).
import type { ReplyTone } from "@/lib/reply-mode";

const CHIP: Record<ReplyTone, string> = {
  accent: "bg-accent-soft text-accent",
  neutral: "bg-sunken text-muted",
  shell: "bg-ok-soft font-mono text-ok",
  warn: "bg-warn-soft text-warn",
};

// The frame's border for a mode that changes what Enter does to something other than sending: a shell command, or
// replacing your last message.
export function modeBorder(tone: ReplyTone): string {
  if (tone === "shell") return "border-ok! focus-within:border-ok!";
  if (tone === "warn") return "border-warn! focus-within:border-warn!";
  return "";
}

export function ModeChip({ tone, text }: { tone: ReplyTone; text: string }) {
  return (
    <div className="flex min-w-0 shrink-0 px-2 pt-1.5">
      <span className={`min-w-0 truncate rounded-full px-2 py-px text-[11px] ${CHIP[tone]}`}>{text}</span>
    </div>
  );
}
