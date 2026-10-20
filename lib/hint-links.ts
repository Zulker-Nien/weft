// A blank's hint in the 🔐 drawer (components/SecretRow.tsx), split so its http(s) links can be drawn as links.
// Trailing punctuation a sentence puts after a URL (".", ",", ")") stays text, unless the URL opened the paren.

export type HintPart = { text: string } | { url: string };

const URL_RE = /https?:\/\/[^\s<>"']+/g;

export function hintParts(hint: string): HintPart[] {
  const parts: HintPart[] = [];
  let at = 0;
  for (const m of hint.matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    const start = m.index;
    if (start > at) parts.push({ text: hint.slice(at, start) });
    parts.push({ url });
    at = start + url.length;
  }
  if (at < hint.length) parts.push({ text: hint.slice(at) });
  return parts;
}

function trimUrl(url: string): string {
  let u = url;
  for (;;) {
    const last = u.at(-1);
    if (last && ".,;:!?".includes(last)) u = u.slice(0, -1);
    else if (last === ")" && count(u, "(") < count(u, ")")) u = u.slice(0, -1);
    else return u;
  }
}

function count(s: string, ch: string) {
  return s.split(ch).length - 1;
}

// What a link shows: its host and path, without the scheme or a trailing slash.
export function linkLabel(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
