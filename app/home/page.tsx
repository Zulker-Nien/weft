import { homeMetadata, loadHome } from "@/lib/home";

// The weft.zip home page, reachable on any Weft at /home; on the deployed Weft, app/page.tsx serves it at / too.
// Loaded through loadHome() so a parse error in components/home/Home.tsx leaves the rest of the app reachable
// (this page shows a small fallback; the build error bar at the bottom shows the real error). See
// docs/bug-fixes/011-home-parse-error-took-board-down.md.
export const metadata = homeMetadata(process.env.NEXT_PUBLIC_APP_VERSION ?? "");

export default async function Page() {
  const result = await loadHome();
  if ("Home" in result) {
    const Home = result.Home as React.ComponentType;
    return <Home />;
  }
  return (
    <div style={{ padding: 32, fontFamily: "system-ui", color: "#ddd", background: "#0b0b0b", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>Home page failed to build</h1>
      <p style={{ marginBottom: 8 }}>The weft.zip page won&apos;t load right now. The rest of the app is unaffected.</p>
      <pre style={{ background: "#1a1a1a", padding: 12, borderRadius: 6, overflow: "auto" }}>
{result.error.file ? `${result.error.file}\n${result.error.message}` : result.error.message}
      </pre>
    </div>
  );
}
