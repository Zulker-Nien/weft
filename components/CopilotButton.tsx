import Icon from "./Icon";

// The top bar's Copilot toggle, with a dot when the copilot needs you.
export default function CopilotButton(props: { open: boolean; needsYou: boolean; title: string; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      title={props.title}
      className={`relative flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] ${props.open ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-ink hover:bg-sunken"}`}
    >
      <Icon name="sparkles" size={14} /> Copilot
      {props.needsYou && (
        <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-warn" title="The copilot needs you" />
      )}
    </button>
  );
}
