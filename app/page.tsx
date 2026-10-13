import type { Metadata } from "next";
import Board from "@/components/Board";
import { homeMetadata, isDeployed, loadHome } from "@/lib/home";

// The board on your Mac; the weft.zip home page on the deployed Weft (Vercel), which has no CLIs to run
// (lib/home.ts). VERCEL is set at build time, so each build renders one or the other. The home is loaded
// dynamically so a parse error in components/home/Home.tsx can't 500 the board route in dev — see
// docs/bug-fixes/011-home-parse-error-took-board-down.md.
export const metadata: Metadata = isDeployed() ? homeMetadata(process.env.NEXT_PUBLIC_APP_VERSION ?? "") : { title: "Weft" };

export default async function Page() {
  if (isDeployed()) {
    const result = await loadHome();
    if ("Home" in result) {
      const Home = result.Home as React.ComponentType;
      return <Home />;
    }
    // In prod (Vercel) the build fails before this runs; in dev the build error bar (lib/build-error.ts) shows
    // the real error. Render a small marker so the page is still a page.
    return <BuildErrorPlaceholder message={result.error.message} file={result.error.file} />;
  }
  return <Board />;
}

function BuildErrorPlaceholder({ message, file }: { message: string; file: string | null }) {
  return (
    <div style={{ padding: 32, fontFamily: "system-ui", color: "#ddd", background: "#0b0b0b", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>Home page failed to build</h1>
      <p style={{ marginBottom: 8 }}>The weft.zip page won&apos;t load right now. The rest of the app is unaffected.</p>
      <pre style={{ background: "#1a1a1a", padding: 12, borderRadius: 6, overflow: "auto" }}>
{file ? `${file}\n${message}` : message}
      </pre>
    </div>
  );
}
