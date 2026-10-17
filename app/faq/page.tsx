import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import FaqDoc from "@/components/home/FaqDoc";
import { HomeFooter, HomeNav } from "@/components/home/HomeChrome";
import { SITE } from "@/lib/home";
import "@/components/home/home.css";

// weft.zip/faq: docs/FAQ.md, the same file GitHub shows, in the home page's nav, palette and footer. Read once at
// module scope, so the page prerenders at build time; next.config.ts traces the file in for the server too.
const FAQ = readFileSync(join(process.cwd(), "docs", "FAQ.md"), "utf8");

export const metadata: Metadata = {
  title: "Weft FAQ",
  description: "Everything people ask about Weft: what it is, how cards and threads work, the browser pane, the vault, the copilot, pricing and privacy.",
  metadataBase: new URL(SITE),
  alternates: { canonical: "/faq" },
};

export default function FaqPage() {
  return (
    <div className="wz-root">
      <HomeNav />
      <FaqDoc markdown={FAQ} />
      <HomeFooter />
    </div>
  );
}
