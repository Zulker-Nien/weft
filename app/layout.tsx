import type { Metadata } from "next";
import BuildErrorBar from "@/components/BuildErrorBar";
import ThemeSync from "@/components/ThemeSync";
import { THEME_SCRIPT } from "@/lib/theme";
import "./fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Weft",
  description: "Engineering the future, one thread at a time",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      // The head script sets data-theme before React hydrates.
      suppressHydrationWarning
    >
      <head>
        <link rel="preload" href="/fonts/geist-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/geist-mono-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="h-full overflow-hidden">
        <ThemeSync />
        {children}
        <BuildErrorBar />
      </body>
    </html>
  );
}
