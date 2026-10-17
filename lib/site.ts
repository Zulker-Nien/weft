// The deployed Weft's origin, on its own so client code can import it. lib/home.ts re-exports it, but importing it
// from there pulls the home page into the client bundle (loadHome's dynamic import of components/home/Home reaches
// lib/home-release.ts, whose "use cache" Next refuses in client code), and the board fails to build.
export const SITE = "https://weft.zip";
