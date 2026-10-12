"use client";

const SUGGESTIONS = [
  "What needs my attention?",
  "Summarize the threads in Review",
  "Which threads are blocked on me?",
];

// What a new copilot chat shows: what it can do, and a few questions to start with.
export default function CopilotEmpty({ onAsk }: { onAsk: (text: string) => void }) {
  return (
    <div className="flex flex-col gap-3 pt-6">
      <p className="text-[13px] leading-relaxed text-muted">
        I can check on your threads, start new ones, and reply to them for you.
      </p>
      <div className="flex flex-col items-start gap-1.5">
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            onClick={() => onAsk(text)}
            className="rounded-full border border-line-strong px-3 py-1 text-[12.5px] text-ink hover:bg-sunken"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
