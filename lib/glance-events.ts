// The glance rail and the chat talk with two window events, since both live in the board's own page:
// glance:scroll-to (a mini was clicked: the chat scrolls to that turn) and glance:pulse (the chat
// scrolled on its own: the rail lights up the turn now at its top). Turn ids are lib/glance-rail.ts turnId().
const SCROLL_TO = "glance:scroll-to";
const PULSE = "glance:pulse";

function listen(name: string, fn: (id: string) => void) {
  const handler = (e: Event) => fn(String((e as CustomEvent).detail));
  window.addEventListener(name, handler);
  return () => window.removeEventListener(name, handler);
}

export const scrollToTurn = (id: string) => window.dispatchEvent(new CustomEvent(SCROLL_TO, { detail: id }));
export const onScrollToTurn = (fn: (id: string) => void) => listen(SCROLL_TO, fn);
export const reportTopTurn = (id: string) => window.dispatchEvent(new CustomEvent(PULSE, { detail: id }));
export const onTopTurn = (fn: (id: string) => void) => listen(PULSE, fn);

export const PULSE_MS = 600;

// A brief accent ring, so the eye finds the turn it jumped to.
export function pulse(el: Element | null | undefined) {
  el?.animate([{ boxShadow: "0 0 0 2px var(--accent)" }, { boxShadow: "0 0 0 2px transparent" }], { duration: PULSE_MS, easing: "ease-out" });
}

// The first turn whose row still shows at the top of the scroller.
export function topmostTurn(scroller: HTMLElement) {
  const top = scroller.getBoundingClientRect().top;
  for (const row of scroller.querySelectorAll<HTMLElement>("[data-turn]")) {
    if (row.getBoundingClientRect().bottom > top + 1) return row.dataset.turn;
  }
  return undefined;
}

export function turnRow(scroller: HTMLElement, id: string) {
  return scroller.querySelector<HTMLElement>(`[data-turn="${CSS.escape(id)}"]`);
}
