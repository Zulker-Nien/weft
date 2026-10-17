import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { DESCRIPTION, TAGLINE } from "@/lib/home";

// The picture a shared weft.zip link shows (Open Graph and Twitter cards): the twin suns scene from the start
// screen, the steel weave emblem and the tagline, in the home page's palette (components/home/home.css).
// Prerendered at build; the root segment, so every route shares it.
export const alt = `Weft: ${TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ASSETS = path.join(process.cwd(), "electron", "assets");

// Satori needs a TrueType font; use the vendored variable font instead of fetching Google Fonts during builds.
async function displayFont(): Promise<ArrayBuffer> {
  const bytes = await readFile(path.join(process.cwd(), "public", "fonts", "fraunces-variable.ttf"));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function dataUrl(file: string, type: string): Promise<string> {
  return `data:${type};base64,${(await readFile(path.join(ASSETS, file))).toString("base64")}`;
}

export default async function Image() {
  const [font, scene, emblem] = await Promise.all([
    displayFont(),
    dataUrl("splash-speeder.jpg", "image/jpeg"),
    dataUrl("emblem.png", "image/png"),
  ]);
  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: "#151a29",
          color: "#ece5d8",
          fontFamily: "Fraunces",
        }}
      >
        <img src={scene} alt="" width={1200} height={1200} style={{ position: "absolute", left: 0, top: -420, objectFit: "cover" }} />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 1200,
            height: 630,
            background: "linear-gradient(90deg, rgba(21,26,41,0.95) 0%, rgba(21,26,41,0.75) 45%, rgba(21,26,41,0.15) 100%)",
          }}
        />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 22 }}>
          <img src={emblem} alt="" width={84} height={84} />
          <div style={{ fontSize: 56, letterSpacing: -1.5 }}>Weft</div>
        </div>
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 22, maxWidth: 820 }}>
          <div style={{ fontSize: 104, lineHeight: 1, letterSpacing: -4 }}>{`${TAGLINE}.`}</div>
          <div style={{ fontSize: 28, lineHeight: 1.35, color: "#d8d0c2", fontFamily: "sans-serif" }}>{`${DESCRIPTION.split(". ")[0]}.`}</div>
        </div>
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", fontSize: 24, color: "#f0995f", fontFamily: "sans-serif" }}>
          <div>weft.zip</div>
          <div>Free, source on GitHub, for macOS</div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Fraunces", data: font, style: "normal", weight: 500 }] },
  );
}
