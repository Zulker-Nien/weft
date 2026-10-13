// The dark plain page shown by app/page.tsx and app/home/page.tsx when loadHome() (lib/home.ts) returns
// a parse error. In prod (Vercel) the build fails before the route runs; in dev the build error bar
// (components/BuildErrorBar.tsx) shows the real error, so this is just a marker so the page is still
// a page. Tailwind-free on purpose: this must work even when the home's CSS or its imports are broken.
export default function HomeErrorFallback({ message, file }: { message: string; file: string | null }) {
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
