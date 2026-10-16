import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import BuildErrorBar from "@/components/BuildErrorBar";
import ThemeSync from "@/components/ThemeSync";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Weft",
  description: "Engineering the future, one thread at a time",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The head script sets data-theme before React hydrates.
      suppressHydrationWarning
    >
      <head>
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
