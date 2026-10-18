// The body of weft.zip/@username under the hero: the builder card's attributes and skills, the activity
// cloth, the badge wall, tokens, records, and the account's public mini apps and threads. Each mirrors a part
// of the Loom's "You" and "Badges" tabs (components/LoomDialog.tsx, LoomBadges.tsx).
import type { PublicApp, PublicThread } from "@/lib/public-profile";
import type { ProfileCard } from "@/lib/profile-card";
import { shortTokens } from "@/lib/usage";
import { CLOTH_TONES, Cloth, Radar, UsageBars } from "./ProfileCharts";

const n = (v: number) => v.toLocaleString("en-US");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const short = (d: string) => day(`${d}T12:00:00Z`);

function duration(ms: number) {
  const min = Math.round(ms / 60_000);
  return min < 60 ? `${min} min` : `${(min / 60).toFixed(1)} h`;
}

function Section({ title, aside, children, className = "" }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`wz-pfSection ${className}`}>
      <div className="wz-pfSectionHead">
        <h2 className="wz-profileSection">{title}</h2>
        {aside && <span className="wz-pfAside">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export function BuilderSection({ card }: { card: ProfileCard }) {
  return (
    <Section title="Builder card" aside={card.className}>
      <div className="wz-pfPanel wz-pfBuilder">
        <Radar attrs={card.attributes} />
        <div className="wz-pfAttrs">
          {card.attributes.map((a) => (
            <div key={a.label} className="wz-pfAttr" title={a.hint}>
              <span className="wz-pfAttrIcon">{a.icon}</span>
              <span className="wz-pfAttrLabel">{a.label}</span>
              <span className="wz-pfAttrTrack">
                <span className="wz-pfAttrFill" style={{ width: `${a.value}%` }} />
              </span>
              <span className="wz-pfAttrValue">{a.value}</span>
              <span className="wz-pfAttrHint">{a.hint}</span>
            </div>
          ))}
          {card.skills.length > 0 && (
            <div className="wz-pfSkills">
              {card.skills.map((s) => (
                <span key={s.tech} className="wz-pfSkill">
                  {s.tech} <b>Lv {s.level}</b>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

export function ClothSection({ card }: { card: ProfileCard }) {
  if (!card.cloth.length) return null;
  const active = card.cloth.filter((d) => d.xp > 0).length;
  return (
    <Section title="The cloth" aside={`${active} active days in 26 weeks`}>
      <div className="wz-pfPanel">
        <Cloth days={card.cloth} />
        <div className="wz-pfLegend">
          <span>Each stitch is a day; brighter means more XP.</span>
          <span className="wz-pfLegendScale">
            Less
            {CLOTH_TONES.map((t) => (
              <i key={t} style={{ background: t }} />
            ))}
            More
          </span>
        </div>
      </div>
    </Section>
  );
}

export function BadgeSection({ card }: { card: ProfileCard }) {
  return (
    <Section title="Badges" aside={`${card.badges.length} of ${card.badgeCount} earned`}>
      {card.badges.length === 0 ? (
        <p className="wz-profileEmpty">No badges yet.</p>
      ) : (
        <ul className="wz-pfBadges">
          {card.badges.map((b) => (
            <li key={b.name} className="wz-pfBadge" title={b.desc}>
              <span className="wz-pfBadgeIcon">{b.icon}</span>
              <span className="wz-pfBadgeName">{b.name}</span>
              <span className="wz-pfBadgeMeta">{b.at ? day(new Date(b.at).toISOString()) : b.group}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function UsageSection({ card }: { card: ProfileCard }) {
  if (!card.usage.length) return null;
  const total = card.usage.reduce((sum, d) => sum + d.tokens, 0);
  return (
    <Section title="Tokens, last 30 days" aside={`${shortTokens(total)} total`}>
      <div className="wz-pfPanel">
        <UsageBars days={card.usage} />
        <div className="wz-pfLegend">
          <span>
            <i className="wz-pfDot" style={{ background: "#f2c36b" }} /> 5-hour limit hit ({n(card.limitHits.fiveHour)} all time)
          </span>
          <span>
            <i className="wz-pfDot" style={{ background: "#ef6f6c" }} /> weekly limit hit ({n(card.limitHits.sevenDay)})
          </span>
        </div>
      </div>
    </Section>
  );
}

export function RecordsSection({ card }: { card: ProfileCard }) {
  const r = card.records;
  const tiles = [
    { label: "Biggest day", value: r.biggestDay ? n(r.biggestDay.cards) : "0", sub: r.biggestDay ? `cards on ${short(r.biggestDay.day)}` : "cards started" },
    { label: "Most shipped", value: r.mostShipped ? n(r.mostShipped.done) : "0", sub: r.mostShipped ? `on ${short(r.mostShipped.day)}` : "in a day" },
    { label: "Fastest ship", value: r.fastestMs !== null ? duration(r.fastestMs) : "–", sub: "idea to Done" },
    { label: "Most at once", value: n(r.maxRunning), sub: "cards running" },
  ];
  return (
    <Section title="Records">
      <div className="wz-pfRecords">
        {tiles.map((t) => (
          <div key={t.label} className="wz-pfRecord">
            <span className="wz-pfBigLabel">{t.label}</span>
            <span className="wz-pfRecordValue">{t.value}</span>
            <span className="wz-pfBigSub">{t.sub}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function AppsSection({ apps }: { apps: PublicApp[] }) {
  if (!apps.length) return null;
  return (
    <Section title="Mini apps">
      <ul className="wz-pfApps">
        {apps.map((a) => (
          <li key={a.id}>
            <a className="wz-pfApp" href={`/a/${a.id}`}>
              <span className="wz-pfAppIcon">▦</span>
              <span>{a.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function ThreadsSection({ threads }: { threads: PublicThread[] }) {
  return (
    <Section title="Public threads" aside={threads.length ? `${threads.length}` : undefined}>
      {threads.length === 0 ? (
        <p className="wz-profileEmpty">No public threads yet.</p>
      ) : (
        <ul className="wz-profileList">
          {threads.map((t) => (
            <li key={t.id}>
              <a className="wz-profileThread" href={`/s/${t.id}`}>
                <span className="wz-profileThreadTitle">{t.title}</span>
                <span className="wz-profileThreadDate">{day(t.updatedAt)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
