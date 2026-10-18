// The welcome's three explaining screens, before the profile and projects (components/WelcomeDialog.tsx draws the frame and the buttons).
// Each one is a small mockup of the real window drawn with the app's own colors, with the explanation written on it.

function Title({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[18px] font-semibold text-ink">{title}</h2>
      <p className="text-[12.5px] text-muted">{children}</p>
    </div>
  );
}

const frame = "overflow-hidden rounded-lg border border-line bg-sunken";

// Screen 1: an open card, the thread on the left and the browser pane on the right, the explanation in the pane.
export function AboutStep() {
  return (
    <div className="flex flex-col gap-3">
      <Title title="Welcome to Weft">A board where every card is an AI coding thread. You bring the idea; Weft runs the threads that plan it, build it and show it to you.</Title>
      <div className={`${frame} flex h-[250px]`} aria-hidden>
        <div className="flex w-[38%] flex-col gap-1.5 border-r border-line p-2">
          <b className="truncate text-[11px] text-ink">🧵 Add a login page</b>
          <span className="w-fit rounded bg-bg px-1.5 py-0.5 text-[9.5px] text-muted">Claude Code · Auto · my-app</span>
          <span className="mt-1 self-end rounded-md bg-accent/20 px-2 py-1 text-[10px] text-ink">add a login page with GitHub sign-in</span>
          <span className="rounded-md bg-bg px-2 py-1 text-[10px] text-muted">Built it. Take a look at the page on the right.</span>
          <span className="mt-auto rounded-md border border-line bg-bg px-2 py-1.5 text-[10px] text-muted">Write the next message</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5 border-b border-line px-2 py-1 text-[9.5px] text-muted">
            <span className="flex-1 truncate rounded bg-bg px-2 py-0.5">localhost:3000/login</span>
            <span>⟳</span>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-hidden p-3 text-[11px] text-muted">
            <b className="text-[12.5px] text-ink">This is the browser pane.</b>
            <span>
              🧵 <b className="text-ink">Each card is a thread</b>: a Claude Code, puku or Codex session working in one of your folders. Start as many as you like.
            </span>
            <span>
              🖥 <b className="text-ink">The pane always shows something</b>: your running app, or a page the thread wrote, so you see the work.
            </span>
            <span>
              🧭 <b className="text-ink">⌘J opens the copilot</b>, which runs the board: ask what&apos;s waiting, start threads, plan a sprint.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const LANES: { name: string; note: string; card?: boolean }[] = [
  { name: "Backlog", note: "Ideas not started. Drop one in with ⌘B." },
  { name: "Running", note: "A thread is working. Several run at once." },
  { name: "Needs you", note: "It asked a question or wants a permission." },
  { name: "Review", note: "Finished. Open it and Weft walks you through the change in the browser pane, one step at a time, then sends your notes back to the thread." },
  { name: "Done", note: "Moving a card here commits and pushes it, refactors the code it touched, and updates the docs and tests." },
];

// Screen 2: an empty board, each swimlane with its explanation written at the top.
export function BoardStep() {
  return (
    <div className="flex flex-col gap-3">
      <Title title="How a card moves">The thread moves its own card as it goes. You step in at Needs you and Review.</Title>
      <div className={`${frame} grid grid-cols-5 gap-1.5 p-1.5`} aria-hidden>
        {LANES.map((lane) => (
          <div key={lane.name} className="flex h-[250px] flex-col gap-1.5 rounded-md border border-dashed border-line bg-bg p-1.5">
            <b className="text-[10.5px] text-ink">{lane.name}</b>
            <span className="text-[9.5px] leading-snug text-muted">{lane.note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const RAIL: { icon: string; name: string; note: string }[] = [
  { icon: "★", name: "Starred", note: "Filter the board to starred cards. Starred cards are never archived." },
  { icon: "🏷", name: "Tags", note: "Label cards like GitHub issues." },
  { icon: "🖥", name: "Services", note: "Every process Weft started: threads, dev servers, terminals." },
  { icon: "🔐", name: "Vault", note: "API keys, encrypted. Threads use them but never see them." },
  { icon: "🪝", name: "Webhooks", note: "Routes providers post to, with a public relay URL." },
  { icon: "▲", name: "Vercel", note: "Link a project, push env vars, see deploys." },
  { icon: "⚡", name: "Supabase", note: "Link a project and apply its migrations." },
  { icon: "☁", name: "Cloudflare", note: "Link a Worker or Pages project." },
  { icon: "🚀", name: "BlastCP", note: "Posting queue for your launch." },
  { icon: "⌥", name: "GitHub", note: "Turn open issues into Backlog cards." },
];

// Screen 3: the left bar, one row per icon.
export function RailStep() {
  return (
    <div className="flex flex-col gap-3">
      <Title title="The left bar">Everything around the board lives in this strip. Open a drawer when you need it.</Title>
      <div className={`${frame} flex`} aria-hidden>
        <div className="flex w-9 shrink-0 flex-col items-center gap-1 border-r border-line bg-bg py-2">
          {RAIL.map((r) => (
            <span key={r.name} className="flex size-6 items-center justify-center rounded text-[13px] text-ink">
              {r.icon}
            </span>
          ))}
        </div>
        <ul className="flex min-w-0 flex-1 flex-col py-1">
          {RAIL.map((r) => (
            <li key={r.name} className="flex h-6 items-center gap-2 px-3 text-[11px]">
              <b className="w-[72px] shrink-0 text-ink">{r.name}</b>
              <span className="truncate text-muted">{r.note}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
