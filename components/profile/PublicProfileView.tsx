// The body of weft.zip/@username (app/u/[username]/page.tsx): the account's picture, name and handle, its
// GitHub link, when it joined, and the threads it shared publicly, each a link to its /s/<id> viewer.
// A server component: nothing on it moves, so it ships no JS.
import Link from "next/link";
import type { PublicProfile } from "@/lib/public-profile";
import "@/components/team/team.css";
import "./profile.css";

const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function Avatar({ profile }: { profile: PublicProfile }) {
  if (profile.avatarUrl) return <img className="wz-profileAvatar" src={profile.avatarUrl} alt="" width={96} height={96} />;
  const initial = (profile.name ?? profile.username).slice(0, 1).toUpperCase();
  return (
    <div className="wz-profileAvatar wz-profileInitial" aria-hidden>
      {initial}
    </div>
  );
}

export function PublicProfileView({ profile }: { profile: PublicProfile }) {
  return (
    <div className="wz-app wz-profile">
      <header className="wz-profileTop">
        <Link className="wz-profileHome" href="/">
          Weft
        </Link>
      </header>
      <main className="wz-profileMain">
        <section className="wz-profileCard">
          <Avatar profile={profile} />
          <div className="wz-profileWho">
            <h1 className="wz-profileName">{profile.name ?? profile.username}</h1>
            <div className="wz-profileHandle">@{profile.username}</div>
            <div className="wz-profileFacts">
              <span>Wefter since {monthYear(profile.memberSince)}</span>
              {profile.githubUrl && (
                <a href={profile.githubUrl} rel="noopener noreferrer me">
                  GitHub
                </a>
              )}
            </div>
          </div>
        </section>
        <section className="wz-profileThreads">
          <h2 className="wz-profileSection">Public threads</h2>
          {profile.threads.length === 0 ? (
            <p className="wz-profileEmpty">No public threads yet.</p>
          ) : (
            <ul className="wz-profileList">
              {profile.threads.map((t) => (
                <li key={t.id}>
                  <a className="wz-profileThread" href={`/s/${t.id}`}>
                    <span className="wz-profileThreadTitle">{t.title}</span>
                    <span className="wz-profileThreadDate">{day(t.updatedAt)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
