// Light, dark, or follow the system. The choice lives in a cookie rather than localStorage because
// the desktop app's server can land on a different port, and cookies don't care about ports. The
// Electron shell reads the same cookie to match its window chrome (electron/main.cjs).
export type Theme = "system" | "light" | "dark";

export const THEMES: { id: Theme; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export const THEME_COOKIE = "weft-theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

export function savedTheme(): Theme {
  const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=(light|dark)`));
  return (match?.[1] as Theme | undefined) ?? "system";
}

// Sets <html data-theme> to the theme in effect: light or dark.
export function applyTheme() {
  const theme = savedTheme();
  const dark = theme === "system" ? matchMedia(DARK_QUERY).matches : theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setTheme(theme: Theme) {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${10 * 365 * 24 * 60 * 60}; SameSite=Lax`;
  applyTheme();
}

// applyTheme, inlined into <head> so the page never paints in the wrong theme.
export const THEME_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark)/);var t=m?m[1]:matchMedia("${DARK_QUERY}").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}})()`;
