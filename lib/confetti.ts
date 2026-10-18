// The confetti an achievement pops (components/AchievementPopup.tsx draws it on a canvas). Pure physics,
// so the shapes and the fall are testable without a browser: `burst` throws pieces up from the two
// lower corners, `step` moves them one frame on, and a piece is gone once it leaves the window.

export interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  // Rotation in radians, and its speed per second.
  rot: number;
  spin: number;
  // The flutter angle (the piece's height in the renderer is `h * Math.cos(flip)`) and its speed.
  flip: number;
  flipSpeed: number;
  w: number;
  h: number;
  color: string;
}

export const CONFETTI_COLORS = ["#f5b942", "#ef6f6c", "#5bc0eb", "#9bc53d", "#c38dff", "#fde74c"];

// A random element of `colors`, falling back to the first. The math always lands in range; the fallback
// is the cheap defense against `rand()` hitting exactly 1, and keeps the type `string` for callers.
function pick(colors: string[], rand: () => number): string {
  return colors[Math.floor(rand() * colors.length)] ?? colors[0] ?? "";
}

// Pixels per second squared (gravity), the speed a piece falls no faster than (terminal velocity), and
// the share of its sideways speed a piece keeps each second (air drag).
const GRAVITY = 900;
const TERMINAL_VY = 420;
const DRAG = 0.35;
const DEFAULT_COUNT = 160;

// `count` pieces thrown up and inward from the lower left and lower right of a `width` × `height` window.
export function burst(width: number, height: number, count: number = DEFAULT_COUNT, rand: () => number = Math.random): Piece[] {
  return Array.from({ length: count }, (_, i) => {
    const left = i % 2 === 0;
    // Up and toward the middle: 50° to 80° above the horizontal.
    const tilt = ((50 + rand() * 30) * Math.PI) / 180;
    const speed = height * (1.1 + rand() * 0.6);
    return {
      x: left ? 0 : width,
      y: height,
      vx: Math.cos(tilt) * speed * (left ? 1 : -1),
      vy: -Math.sin(tilt) * speed,
      rot: rand() * Math.PI * 2,
      spin: (rand() - 0.5) * 12,
      flip: rand() * Math.PI * 2,
      flipSpeed: (rand() - 0.5) * 6,
      w: 6 + rand() * 6,
      h: 4 + rand() * 4,
      color: pick(CONFETTI_COLORS, rand),
    };
  });
}

// The pieces still on screen `dt` seconds later. Drag slows them sideways, gravity pulls them down and
// caps the fall at terminal velocity, and a piece is gone once it leaves the window.
export function step(pieces: Piece[], dt: number, width: number, height: number): Piece[] {
  const keep = DRAG ** dt;
  return pieces
    .map((p) => {
      const vy = Math.min(p.vy + GRAVITY * dt, TERMINAL_VY);
      return {
        ...p,
        x: p.x + p.vx * dt,
        y: p.y + vy * dt,
        vx: p.vx * keep,
        vy,
        rot: p.rot + p.spin * dt,
        flip: p.flip + p.flipSpeed * dt,
      };
    })
    .filter((p) => p.x >= 0 && p.x <= width && p.y <= height + p.w);
}
