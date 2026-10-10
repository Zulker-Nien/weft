import type { CSSProperties } from "react";

// For overlays laid over the header (an open card, a dialog's backdrop). On macOS the header's
// drag region still acts as the title bar under them, so clicks there would move the window instead.
export const NO_DRAG = { WebkitAppRegion: "no-drag" } as CSSProperties;
