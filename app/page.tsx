import type { Metadata } from "next";
import Board from "@/components/Board";
import Home from "@/components/home/Home";
import { homeMetadata, isDeployed } from "@/lib/home";

// The board on your Mac; the weft.zip home page on the deployed Weft (Vercel), which has no CLIs to run
// (lib/home.ts). VERCEL is set at build time, so each build renders one or the other.
export const metadata: Metadata = isDeployed() ? homeMetadata(process.env.NEXT_PUBLIC_APP_VERSION ?? "") : { title: "Weft" };

export default function Page() {
  return isDeployed() ? <Home /> : <Board />;
}
