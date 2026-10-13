// Google Analytics 4 for the weft.zip home page only. Rendered server-side so the snippet is
// in the HTML before the page paints; gtag.js sends a single page_view on load and configures
// the G-... ID. Co-located with the home page (mounted by components/home/Home.tsx), never
// in app/layout.tsx, so local board sessions never call home.
const GA_ID = "G-L9YCWJ4LZ2";

const SNIPPET = `
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', ${JSON.stringify(GA_ID)});
`;

export default function GoogleAnalytics() {
  return (
    <>
      <script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`}
      />
      <script dangerouslySetInnerHTML={{ __html: SNIPPET }} />
    </>
  );
}
