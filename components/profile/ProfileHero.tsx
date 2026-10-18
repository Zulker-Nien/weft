// The top of weft.zip/@username: the picture in its level ring, name, class, bio, the GitHub facts and this
// week's league, then the big numbers. The Loom's own header is components/LoomProfile.tsx.
import type { PublicProfile } from "@/lib/public-profile";
import type { ProfileCard } from "@/lib/profile-card";
import { LevelRing } from "./ProfileCharts";

const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const n = (v: number) => v.toLocaleString("en-US");
const bare = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

function Avatar({ profile }: { profile: PublicProfile }) {
  if (profile.avatarUrl) return <img className="wz-profileAvatar" src={profile.avatarUrl} alt="" width={112} height={112} />;
  const initial = (profile.name ?? profile.username).slice(0, 1).toUpperCase();
  return (
    <div className="wz-profileAvatar wz-profileInitial" aria-hidden>
      {initial}
    </div>
  );
}

function Facts({ profile, card }: { profile: PublicProfile; card: ProfileCard | null }) {
  const gh = card?.github;
  const items = [
    gh?.location && <span key="loc">📍 {gh.location}</span>,
    gh?.company && <span key="co">🏢 {gh.company}</span>,
    gh?.blog && (
      <a key="blog" href={gh.blog} rel="noopener noreferrer me">
        🔗 {bare(gh.blog)}
      </a>
    ),
    profile.githubUrl && (
      <a key="gh" href={profile.githubUrl} rel="noopener noreferrer me">
        GitHub
      </a>
    ),
    gh && <span key="fol">{n(gh.followers)} followers</span>,
    gh && <span key="repos">{n(gh.publicRepos)} repos</span>,
    <span key="since">Wefter since {monthYear(profile.memberSince)}</span>,
  ].filter(Boolean);
  return <div className="wz-profileFacts">{items}</div>;
}

function League({ profile }: { profile: PublicProfile }) {
  const l = profile.league;
  if (!l) return null;
  return (
    <div className="wz-pfLeague" title={`Week of ${l.week}: ${n(l.xp)} XP, ${n(l.shipped)} shipped`}>
      <span className="wz-pfLeagueTier">{l.name} league</span>
      <span>
        #{l.rank} of {l.size} this week · {n(l.xp)} XP
      </span>
    </div>
  );
}

export function ProfileHero({ profile }: { profile: PublicProfile }) {
  const card = profile.card;
  const avatar = <Avatar profile={profile} />;
  return (
    <section className="wz-profileCard wz-pfHero">
      {card ? (
        <LevelRing value={card.xp - card.level.floor} max={card.level.next - card.level.floor}>
          {avatar}
          <span className="wz-pfLevelChip">Lv {card.level.level}</span>
        </LevelRing>
      ) : (
        avatar
      )}
      <div className="wz-profileWho">
        {card && (
          <div className="wz-pfClass">
            {card.className} · {card.level.title}
          </div>
        )}
        <h1 className="wz-profileName">{profile.name ?? profile.username}</h1>
        <div className="wz-profileHandle">@{profile.username}</div>
        {card?.github?.bio && <p className="wz-pfBio">{card.github.bio}</p>}
        <Facts profile={profile} card={card} />
        <League profile={profile} />
      </div>
    </section>
  );
}

function Big({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="wz-pfBig">
      <span className="wz-pfBigValue">{value}</span>
      <span className="wz-pfBigLabel">{label}</span>
      {sub && <span className="wz-pfBigSub">{sub}</span>}
    </div>
  );
}

// The big numbers under the hero, and the XP bar toward the next level.
export function ProfileNumbers({ card }: { card: ProfileCard }) {
  const { level, streak } = card;
  const pct = level.next > level.floor ? Math.min(100, (100 * (card.xp - level.floor)) / (level.next - level.floor)) : 0;
  return (
    <section className="wz-pfNumbers">
      <div className="wz-pfXp">
        <div className="wz-pfXpRow">
          <span>
            Level {level.level} · {level.title}
          </span>
          <span>
            {n(card.xp)} / {n(level.next)} XP
          </span>
        </div>
        <div className="wz-pfXpTrack">
          <div className="wz-pfXpFill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="wz-pfBigs">
        <Big label="XP earned" value={n(card.xp)} />
        <Big label="Cards shipped" value={n(card.totals.shipped)} sub={`of ${n(card.totals.started)} started`} />
        <Big label="Wefting streak" value={`🔥 ${streak.current}`} sub={`best ${streak.best} · 🧊 ${streak.freezes}`} />
        <Big label="Badges" value={`${card.badges.length}`} sub={`of ${card.badgeCount}`} />
      </div>
    </section>
  );
}
