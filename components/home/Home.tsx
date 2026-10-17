import Image from "next/image";
import Link from "next/link";
import GoogleAnalytics from "@/components/GoogleAnalytics";
import emblem from "@/electron/assets/emblem.png";
import twinSuns from "@/electron/assets/splash-speeder.jpg";
import { AIMHUGE, COFFEE, REPO, TAGLINE, downloadLink } from "@/lib/home";
import { latestRelease } from "@/lib/home-release";
import board from "@/public/brand/board.png";
import Pillars from "./Pillars";
import "./home.css";

// The weft.zip home page (lib/home.ts has what it says and links to): the name, one
// sentence, the download, a real screenshot of the board (public/brand/board.png) over the start screen's
// twin suns, then the five pillars. A server component with no client JS. Fraunces for display, Instrument Sans for text.
export default async function Home() {
  const download = downloadLink(await latestRelease());
  return (
    <>
      <GoogleAnalytics />
      <div className="wz-root">
        <nav className="wz-wrap wz-nav">
          <span className="wz-brand">
            <Image src={emblem} alt="" width={28} height={28} className="wz-emblem" /> Weft
          </span>
          <div className="flex items-center gap-5">
            <Link href="/login">Sign in</Link>
            <a href={REPO}>GitHub</a>
          </div>
        </nav>

        <header className="wz-hero">
          <Image src={twinSuns} alt="" fill priority sizes="100vw" className="wz-photo" />
          <div className="wz-scrim" />
          <div className="wz-wrap wz-heroInner">
            <p className="wz-eyebrow wz-rise">Agentic engineering, on your Mac</p>
            <h1 className="wz-h1 wz-rise">
              {TAGLINE},<br /> <em>one thread at a time.</em>
            </h1>
            <p className="wz-lede wz-rise wz-d1">
              A Mac kanban board where every card is a Claude Code thread. You bring the idea; Weft plans it, builds it and shows it to you.
            </p>
            <div className="wz-ctas wz-rise wz-d2">
              <a className="wz-btn wz-btnPrimary" href={download.href}>
                {download.label}
              </a>
            </div>
            <p className="wz-note wz-rise wz-d2">{download.note}</p>
          </div>
        </header>

        <div className="wz-wrap wz-shotWrap wz-rise wz-d3">
          <div className="wz-shot">
            <Image src={board} alt="The Weft board: Backlog, Running, Needs you, Review and Done, each card a thread" priority sizes="(max-width: 1216px) 100vw, 1104px" />
          </div>
        </div>

        <Pillars />

        <footer className="wz-wrap wz-footer">
          Made with{" "}
          <a href={COFFEE} title="Buy me a coffee">
            ☕
          </a>{" "}
          by <a href={AIMHUGE}>aimhuge.com</a> · Weft™ is free, with its source on <a href={REPO}>GitHub</a>
        </footer>
      </div>
    </>
  );
}
