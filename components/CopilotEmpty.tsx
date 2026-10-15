"use client";

const SUGGESTIONS = [
  "Help me get started with Weft",
  "How can I improve my codebase?",
  "How many users did I get last week?",
  "Tell me about my productivity over the last 2 months",
  "Let's make a new feature",
  "How did a feature change user behavior?",
  "Let's commit all the new stuff",
];

// What a new copilot chat shows: what it can do, and a few questions to start with. The chips wrap
// side by side so seven of them fit a narrow lane, and a long one breaks onto a second line.
export default function CopilotEmpty({ onAsk }: { onAsk: (text: string) => void }) {
  return (
    <div className="flex flex-col gap-3 pt-6">
      <p className="text-[13px] leading-relaxed text-muted">
        I can check on your threads, start new ones, and reply to them for you.
      </p>
      <div className="flex flex-wrap items-start gap-1.5">
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            onClick={() => onAsk(text)}
            className="max-w-full rounded-2xl border border-line-strong bg-canvas/70 px-3 py-1 text-left text-[12.5px] leading-snug text-ink hover:bg-sunken"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
