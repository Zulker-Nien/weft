// A league email's button (lib/league-mail-copy.ts): mail apps drop weft:// links, so the email links here and this
// hands the browser on to the app, which opens Weft (electron/main.cjs handleLink).
export function GET() {
  return new Response(null, { status: 302, headers: { location: "weft://league" } });
}
