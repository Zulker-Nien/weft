import Image from "next/image";
import { Fraunces, Instrument_Sans } from "next/font/google";
import emblem from "@/electron/assets/emblem.png";
import twinSuns from "@/electron/assets/splash-speeder.jpg";
import { REPO, downloadLink } from "@/lib/home";
import { latestRelease } from "@/lib/home-release";
import board from "@/public/brand/board.png";
import "./home.css";

// The weft.zip home page (lib/home.ts has what it says and links to). One screen, on purpose: the name, one
// sentence, the download, and a real screenshot of the board (public/brand/board.png) over the start screen's
// twin suns. A server component with no client JS. Fraunces for display, Instrument Sans for text.
const fraunces = Fraunces({ subsets: ["latin"], axes: ["SOFT", "WONK", "opsz"], variable: "--font-fraunces", display: "swap" });
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });

export default async function Home() {
  const download = downloadLink(await latestRelease());
  return (
    <div className={`${fraunces.variable} ${instrument.variable} wz-root`}>
      <nav className="wz-wrap wz-nav">
        <span className="wz-brand">
          <Image src={emblem} alt="" width={28} height={28} className="wz-emblem" /> Weft
        </span>
        <a href={REPO}>GitHub</a>
      </nav>

      <header className="wz-hero">
        <Image src={twinSuns} alt="" fill priority sizes="100vw" className="wz-photo" />
        <div className="wz-scrim" />
        <div className="wz-wrap wz-heroInner">
          <h1 className="wz-h1 wz-rise">
            A board for <em>your AI.</em>
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

      <footer className="wz-wrap wz-footer">
        Free and open source · <a href={REPO}>github.com/aimhuge/weft</a>
      </footer>
    </div>
  );
}
