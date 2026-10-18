import { splitFileRefs, type FileIndex } from "./file-refs";

// A remark plugin for components/Markdown.tsx: file names in a message's prose become links to the editor column.
// Each mention lib/file-refs.ts finds in a text node turns into a link node whose url is FILE_SCHEME + path
// (+ "#L" + line), which Markdown's `a` draws as a button. Text inside links, code and HTML is left alone;
// inline code is linked by Markdown's own `code` component.

export const FILE_SCHEME = "weft-file:";

interface Node {
  type: string;
  value?: string;
  url?: string;
  children?: Node[];
}

// Parent types whose text isn't prose to link.
const SKIP = new Set(["link", "linkReference", "code", "inlineCode", "html", "definition"]);

export function fileHref(path: string, line?: number): string {
  return `${FILE_SCHEME}${encodeURIComponent(path)}${line ? `#L${line}` : ""}`;
}

// The path and line a FILE_SCHEME href carries, or null for any other href.
export function parseFileHref(href: string): { path: string; line?: number } | null {
  if (!href.startsWith(FILE_SCHEME)) return null;
  const [rawPath = "", hash] = href.slice(FILE_SCHEME.length).split("#L");
  const path = decodeURIComponent(rawPath);
  const line = hash ? Number(hash) : undefined;
  return line ? { path, line } : { path };
}

function linkify(node: Node, index: FileIndex): void {
  if (!node.children || SKIP.has(node.type)) return;
  node.children = node.children.flatMap((child): Node[] => {
    if (child.type !== "text" || !child.value) {
      linkify(child, index);
      return [child];
    }
    const pieces = splitFileRefs(index, child.value);
    if (pieces.length === 1 && typeof pieces[0] === "string") return [child];
    return pieces.map((p) =>
      typeof p === "string" ? { type: "text", value: p } : { type: "link", url: fileHref(p.ref.path, p.ref.line), children: [{ type: "text", value: p.text }] },
    );
  });
}

export function remarkFileLinks(index: FileIndex) {
  return (tree: Node) => linkify(tree, index);
}
