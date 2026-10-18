// The public profile's charts (components/profile/PublicProfileView.tsx), drawn on the server as plain SVG:
// the level ring around the picture, the attribute radar, the activity cloth and the token bars. The Loom's
// own charts (components/LoomCharts.tsx, LoomUsage.tsx) are client components with hover read-outs; on the
// web a native <title> does that job, so these ship no JS.
import type { CardAttribute, CardDay, CardUsageDay } from "@/lib/profile-card";
import { shortTokens } from "@/lib/usage";

// The picture inside a ring that fills with the XP toward the next level.
export function LevelRing({ value, max, size = 136, children }: { value: number; max: number; size?: number; children: React.ReactNode }) {
  const r = size / 2 - 5;
  const len = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className="wz-pfRing" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden>
        <defs>
          <linearGradient id="wz-pfRingGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f2c36b" />
            <stop offset="1" stopColor="#da7a4c" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(236 229 216 / 0.1)" strokeWidth={5} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#wz-pfRingGrad)"
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={`${len * pct} ${len}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="wz-pfRingInner">{children}</div>
    </div>
  );
}

// One spoke per attribute, 0 at the center and 100 at the rim.
export function Radar({ attrs, size = 240 }: { attrs: CardAttribute[]; size?: number }) {
  const r = size / 2 - 30;
  const point = (i: number, len: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / attrs.length;
    return [Math.cos(a) * len, Math.sin(a) * len] as const;
  };
  const ring = (k: number) => attrs.map((_, i) => point(i, r * k).join(",")).join(" ");
  const shape = attrs.map((a, i) => point(i, (r * a.value) / 100).join(",")).join(" ");
  return (
    <svg className="wz-pfRadar" viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} width={size} height={size} role="img" aria-label="Builder attributes">
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon key={k} points={ring(k)} fill="none" stroke="rgb(236 229 216 / 0.1)" />
      ))}
      {attrs.map((a, i) => {
        const [x, y] = point(i, r);
        const [lx, ly] = point(i, r + 16);
        return (
          <g key={a.label}>
            <line x1={0} y1={0} x2={x} y2={y} stroke="rgb(236 229 216 / 0.08)" />
            <text x={lx} y={ly + 5} textAnchor="middle" fontSize={14}>
              <title>{`${a.label}: ${a.value}`}</title>
              {a.icon}
            </text>
          </g>
        );
      })}
      <polygon points={shape} fill="rgb(242 195 107 / 0.22)" stroke="#f2c36b" strokeWidth={1.6} strokeLinejoin="round" />
      {attrs.map((a, i) => {
        const [x, y] = point(i, (r * a.value) / 100);
        return <circle key={a.label} cx={x} cy={y} r={2.6} fill="#f2c36b" />;
      })}
    </svg>
  );
}

const TONES = ["rgb(236 229 216 / 0.06)", "rgb(242 195 107 / 0.28)", "rgb(242 195 107 / 0.5)", "rgb(240 153 95 / 0.75)", "#f0995f"];

function stitchTitle(s: CardDay) {
  if (s.tone === -1) return `${s.day}: a streak freeze covered this day`;
  return `${s.day}: ${s.xp ? `${s.xp} XP` : "nothing"}`;
}

// The activity heatmap as woven cloth: a column per week, a row per weekday, each day a stitch running
// across or down by turns, like weft over warp. Brighter means more XP that day.
export function Cloth({ days }: { days: CardDay[] }) {
  const cell = 14;
  const weeks = Math.ceil(days.length / 7);
  return (
    <svg className="wz-pfCloth" viewBox={`0 0 ${weeks * cell} ${7 * cell}`} width="100%" role="img" aria-label="Activity, last 26 weeks">
      {days.map((s, i) => {
        const col = Math.floor(i / 7);
        const row = i % 7;
        const across = (col + row) % 2 === 0;
        return (
          <rect
            key={s.day}
            x={col * cell + (across ? 0.75 : 3.5)}
            y={row * cell + (across ? 3.5 : 0.75)}
            width={across ? cell - 1.5 : cell - 7}
            height={across ? cell - 7 : cell - 1.5}
            rx={2.5}
            fill={s.tone === -1 ? "rgb(126 182 255 / 0.25)" : (TONES[s.tone] ?? TONES[0])}
            stroke={s.tone === -1 ? "#7eb6ff" : "none"}
            strokeWidth={0.7}
          >
            <title>{stitchTitle(s)}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export const CLOTH_TONES = TONES;

const W = 640;
const H = 120;
const TOP = 18;
const BOTTOM = 16;

// Tokens per day for the last 30 days, with a dot over each day a plan limit ran out: gold for the 5-hour
// window, red for the weekly one.
export function UsageBars({ days }: { days: CardUsageDay[] }) {
  const peak = Math.max(1, ...days.map((d) => d.tokens));
  const slot = W / Math.max(1, days.length);
  const plot = H - TOP - BOTTOM;
  return (
    <svg className="wz-pfUsage" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Tokens per day, last 30 days">
      <defs>
        <linearGradient id="wz-pfBarGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0995f" />
          <stop offset="1" stopColor="#da7a4c" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <line x1={0} x2={W} y1={H - BOTTOM} y2={H - BOTTOM} stroke="rgb(236 229 216 / 0.1)" />
      {days.map((d, i) => {
        const h = d.tokens ? Math.max(3, (plot * d.tokens) / peak) : 0;
        const x = i * slot + 2;
        const w = slot - 4;
        const y = H - BOTTOM - h;
        const marks = [d.fiveHour > 0 && "#f2c36b", d.sevenDay > 0 && "#ef6f6c"].filter((m): m is string => Boolean(m));
        return (
          <g key={d.day}>
            <title>{`${d.day}: ${shortTokens(d.tokens)} tokens${d.fiveHour ? ` · ${d.fiveHour} 5-hour limit hit` : ""}${d.sevenDay ? ` · ${d.sevenDay} weekly limit hit` : ""}`}</title>
            <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
            {h > 0 && <rect x={x} y={y} width={w} height={h} rx={Math.min(3, w / 2)} fill="url(#wz-pfBarGrad)" />}
            {marks.map((fill, k) => (
              <circle key={fill} cx={x + w / 2} cy={Math.min(y, H - BOTTOM) - 6 - k * 9} r={3.5} fill={fill} stroke="#171d31" strokeWidth={1.5} />
            ))}
          </g>
        );
      })}
      {[days[0], days[days.length - 1]].map((d, k) =>
        d ? (
          <text key={d.day} x={k ? W : 0} y={H - 2} textAnchor={k ? "end" : "start"} fontSize={10.5} fill="#8d887e">
            {d.day.slice(5)}
          </text>
        ) : null,
      )}
    </svg>
  );
}
