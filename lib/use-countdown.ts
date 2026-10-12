import { useEffect, useState } from "react";

// A countdown you arm, for a click that only takes once it runs out (components/CountdownButton.tsx).
// left is what's left in ms, ticking every 100ms down to 0, or null while disarmed.
export function useCountdown(ms: number): { left: number | null; arm: () => void; disarm: () => void } {
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (armedAt === null) return;
    const tick = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t - armedAt >= ms) clearInterval(tick);
    }, 100);
    return () => clearInterval(tick);
  }, [armedAt, ms]);
  return {
    left: armedAt === null ? null : Math.max(0, ms - (now - armedAt)),
    arm: () => {
      const t = Date.now();
      setArmedAt(t);
      setNow(t);
    },
    disarm: () => setArmedAt(null),
  };
}
