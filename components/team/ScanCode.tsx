// A decorative scan stripe drawn from a seed (an invoice number), so every ticket and sheet has its own and the
// same invoice always draws the same one. It encodes nothing: don't put words like "scan to open" next to it.
export function ScanCode({ seed: given, className = "wz-invoiceCode" }: { seed: string; className?: string }) {
  const seed = given || "weft";
  let x = 0;
  const bars: { x: number; w: number }[] = [];
  for (let i = 0; i < 26; i++) {
    const w = 1 + ((seed.charCodeAt(i % seed.length) + i * 7) % 3);
    bars.push({ x, w });
    x += w + 1 + ((seed.charCodeAt((i + 3) % seed.length) + i) % 2);
  }
  return (
    <svg className={className} viewBox={`0 0 ${x} 12`} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((b) => (
        <rect key={b.x} x={b.x} y="0" width={b.w} height="12" />
      ))}
    </svg>
  );
}
