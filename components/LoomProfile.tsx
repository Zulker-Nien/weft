"use client";

import type { GithubProfile } from "@/lib/github-profile";

// The desktop shell opens links in the default browser; the web build uses the link as is.
function openLink(e: React.MouseEvent, url: string) {
  if (!window.threadboard) return;
  e.preventDefault();
  window.threadboard.openExternal(url);
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} onClick={(e) => openLink(e, href)} className="hover:text-accent hover:underline">
      {children}
    </a>
  );
}

// The top of the Loom's "You" tab: "Wefter: name · class", and your GitHub profile when gh is signed in
// (picture, @login, bio, where you are and what you've put out).
export default function LoomProfile({ name, className, github }: { name: string; className: string; github?: GithubProfile | null }) {
  const facts = github
    ? [
        github.location && <span key="loc">📍 {github.location}</span>,
        github.company && <span key="co">{github.company}</span>,
        github.blog && <Link key="blog" href={github.blog}>{github.blog.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</Link>,
        <span key="fol" className="tabular-nums">{github.followers.toLocaleString()} followers</span>,
        <span key="repos" className="tabular-nums">{github.publicRepos.toLocaleString()} repos</span>,
      ].filter(Boolean)
    : [];
  return (
    <div className="flex items-start gap-3">
      {github?.avatarUrl && <img src={github.avatarUrl} alt="" width={48} height={48} className="mt-0.5 shrink-0 rounded-full border border-line" />}
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="text-[18px] font-semibold text-ink">
          <span className="font-normal text-muted">Wefter:</span> {github?.name ?? name} · <span className="text-warn">{className}</span>
        </div>
        {github && (
          <>
            <div className="line-clamp-2 text-[12.5px] text-ink">
              <Link href={github.url}>
                <span className="text-muted">@{github.login}</span>
              </Link>
              {github.bio && <> · {github.bio}</>}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
              {facts.map((f, i) => (
                <span key={i} className="flex items-center gap-2">
                  {i > 0 && <span aria-hidden>·</span>}
                  {f}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
