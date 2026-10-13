import ts from "typescript";

// The declarations an edit touches, for symbol claims (lib/claims.ts): the top-level function, component,
// class, type or interface around an Edit's old_string, or for a long one the statement inside it
// (NEST_LINES), found with the TypeScript parser. Parsing alone, no
// type-checker, so a big file takes a few milliseconds. Loaded only when a thread first edits a source file
// (lib/claim-guard.ts imports it lazily), so the parser never costs anything on the start-a-card path.

const SOURCE = /\.([cm]?[jt]sx?)$/i;

// Files the parser can read; anything else is claimed whole.
export function isSourceFile(file: string) {
  return SOURCE.test(file);
}

function scriptKind(file: string) {
  const ext = file.toLowerCase();
  if (ext.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (ext.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(ext)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

// Names in a destructuring pattern: `const { a, b: [c] } = …` -> a, c.
function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : boundNames(el.name)));
}

const DEFAULT = ts.SyntaxKind.DefaultKeyword;

// `export default function () {}` has no name of its own; a nameless one that isn't the default is a
// parse error a thread can still write.
function functionOrClassName(stmt: ts.FunctionDeclaration | ts.ClassDeclaration): string[] | null {
  if (stmt.name?.text) return [stmt.name.text];
  return ts.getModifiers(stmt)?.some((m) => m.kind === DEFAULT) ? ["default"] : null;
}

// What a top-level statement declares: its names, [] for imports (never claimed), or null when it has
// no name (a bare call, an if block), which makes the edit claim the whole file.
export function statementNames(stmt: ts.Statement): string[] | null {
  if (ts.isImportDeclaration(stmt) || ts.isImportEqualsDeclaration(stmt) || ts.isExportDeclaration(stmt)) return [];
  if (ts.isExportAssignment(stmt)) return ["default"];
  if (ts.isVariableStatement(stmt)) return stmt.declarationList.declarations.flatMap((d) => boundNames(d.name));
  if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) return functionOrClassName(stmt);
  if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt) || ts.isModuleDeclaration(stmt)) {
    return [stmt.name.text];
  }
  return null;
}

// Past this many lines a symbol is split: the edit claims the statement inside it that holds the edit
// (`Board/moveFocus`), and so on down. Board() in components/Board.tsx is 85% of the file, so claiming it
// whole would be a whole-file claim in practice.
export const NEST_LINES = 150;

function unwrap(node: ts.Node | undefined): ts.Node | undefined {
  let n = node;
  while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isNonNullExpression(n) || ts.isAwaitExpression(n))) n = n.expression;
  return n;
}

// What an expression splits into: a function's body statements (an arrow's JSX body, its children), a
// class's members, a JSX element's children, or a call's first function argument's (memo(…), useEffect(…),
// describe("…", …)). Undefined when it doesn't split.
function innerParts(node: ts.Node | undefined): ts.NodeArray<ts.Node> | undefined {
  const n = unwrap(node);
  if (!n) return undefined;
  if (ts.isFunctionLike(n)) {
    const body = (n as ts.FunctionLikeDeclarationBase).body;
    return body && ts.isBlock(body) ? body.statements : innerParts(body);
  }
  if (ts.isClassLike(n)) return n.members;
  if (ts.isJsxElement(n) || ts.isJsxFragment(n)) return n.children;
  if (ts.isCallExpression(n)) {
    for (const arg of n.arguments) {
      const parts = innerParts(arg);
      if (parts) return parts;
    }
  }
  return undefined;
}

// What a long statement (or class member, or JSX child) splits into, if anything.
function partsOf(node: ts.Node): ts.NodeArray<ts.Node> | undefined {
  if (ts.isVariableStatement(node)) {
    const decls = node.declarationList.declarations;
    return decls.length === 1 ? innerParts((decls[0] as ts.VariableDeclaration).initializer) : undefined;
  }
  if (ts.isPropertyDeclaration(node)) return innerParts(node.initializer);
  if (ts.isReturnStatement(node) || ts.isExpressionStatement(node) || ts.isExportAssignment(node) || ts.isJsxExpression(node)) {
    return innerParts(node.expression);
  }
  return innerParts(node);
}

const KINDS: Partial<Record<ts.SyntaxKind, string>> = {
  [ts.SyntaxKind.ReturnStatement]: "return",
  [ts.SyntaxKind.IfStatement]: "if",
  [ts.SyntaxKind.ForStatement]: "for",
  [ts.SyntaxKind.ForOfStatement]: "for",
  [ts.SyntaxKind.ForInStatement]: "for",
  [ts.SyntaxKind.WhileStatement]: "while",
  [ts.SyntaxKind.DoStatement]: "while",
  [ts.SyntaxKind.TryStatement]: "try",
  [ts.SyntaxKind.SwitchStatement]: "switch",
  [ts.SyntaxKind.ThrowStatement]: "throw",
  [ts.SyntaxKind.Constructor]: "constructor",
  [ts.SyntaxKind.JsxFragment]: "fragment",
  [ts.SyntaxKind.JsxText]: "text",
};

// `useEffect(…)` -> useEffect, `ipcMain.handle(…)` -> ipcMain.handle, `load().then(…)` -> then.
function callName(node: ts.Node | undefined): string | undefined {
  const n = unwrap(node);
  if (!n || !ts.isCallExpression(n)) return undefined;
  const callee = n.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return ts.isIdentifier(callee.expression) ? `${callee.expression.text}.${callee.name.text}` : callee.name.text;
  return undefined;
}

// The source is passed in: the parse skips parent links, which getText() would otherwise walk up.
function tagName(node: ts.JsxElement | ts.JsxSelfClosingElement, source: ts.SourceFile) {
  return (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText(source);
}

// The first JSX tag inside `{open && <Dialog/>}`.
function firstTag(node: ts.Node, source: ts.SourceFile): string | undefined {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return tagName(node, source);
  return ts.forEachChild(node, (child) => firstTag(child, source));
}

// What a statement inside a long symbol is called: its declared name, the hook or function it calls,
// a JSX child's tag, or its kind (`return`, `if`).
function partLabel(node: ts.Node, source: ts.SourceFile): string {
  if (ts.isVariableStatement(node)) return boundNames((node.declarationList.declarations[0] as ts.VariableDeclaration).name)[0] ?? "const";
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isClassElement(node)) && node.name) return node.name.getText(source);
  if (ts.isExpressionStatement(node)) return callName(node.expression) ?? "expression";
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return tagName(node, source);
  if (ts.isJsxExpression(node)) return firstTag(node, source) ?? "expression";
  return KINDS[node.kind] ?? "statement";
}

// Labels for siblings, a repeated one numbered by order among its kind: useEffect#1, useEffect#2.
function siblingLabels(parts: readonly ts.Node[], source: ts.SourceFile): string[] {
  const labels = parts.map((p) => partLabel(p, source));
  const seen = new Map<string, number>();
  return labels.map((l) => {
    if (labels.indexOf(l) === labels.lastIndexOf(l)) return l;
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    return `${l}#${n}`;
  });
}

interface Walk {
  source: ts.SourceFile;
  start: number;
  end: number;
  names: Set<string>;
}

function long(w: Walk, node: ts.Node) {
  const line = (pos: number) => w.source.getLineAndCharacterOfPosition(pos).line;
  return line(node.end) - line(node.getStart(w.source)) + 1 > NEST_LINES;
}

const overlaps = (w: Walk, node: ts.Node) => node.pos < w.end && node.end > w.start;
const blankText = (node: ts.Node) => ts.isJsxText(node) && node.containsOnlyTriviaWhiteSpaces;

// Claims the parts of a symbol named `name` the span touches, going further down any long one; false when
// the symbol doesn't split or the span touches its own lines (a signature, a closing brace), so the caller
// claims it whole.
function claimInside(w: Walk, node: ts.Node, name: string): boolean {
  if (!long(w, node)) return false;
  const parts = partsOf(node);
  if (!parts || w.start < parts.pos || w.end > parts.end) return false;
  const kids = parts.filter((k) => !blankText(k));
  const labels = siblingLabels(kids, w.source);
  let hit = false;
  kids.forEach((kid, i) => {
    if (!overlaps(w, kid)) return;
    hit = true;
    const path = `${name}/${labels[i] as string}`;
    if (!claimInside(w, kid, path)) w.names.add(path);
  });
  return hit;
}

// Adds the names of the top-level statements a span overlaps (each statement with its leading comments),
// split as claimInside does when long; false when one of them has no name.
function addNamesAt(w: Walk): boolean {
  for (const stmt of w.source.statements) {
    if (!overlaps(w, stmt)) continue;
    const found = statementNames(stmt);
    if (!found) return false;
    if (found.length === 1 && claimInside(w, stmt, found[0] as string)) continue;
    for (const n of found) w.names.add(n);
  }
  return true;
}

// Every place old_string sits in the text (only the first, unless the edit replaces them all), less its
// leading and trailing whitespace: the blank line after a function's closing brace belongs to the next
// statement, and an edit that ends there shouldn't claim it.
function spans(text: string, oldString: string, all: boolean): [number, number][] {
  const lead = oldString.length - oldString.trimStart().length;
  const trail = oldString.length - oldString.trimEnd().length;
  const out: [number, number][] = [];
  for (let at = text.indexOf(oldString); at >= 0; at = all ? text.indexOf(oldString, at + oldString.length) : -1) {
    out.push([at + lead, Math.max(at + lead, at + oldString.length - trail)]);
  }
  return out;
}

// The symbols an Edit of old_string touches in this text (`Board/useEffect#3` inside a long one), or null for the whole file: old_string
// isn't there (or is empty), or a statement it touches has no name. [] when it touches only imports.
export function symbolsFor(file: string, text: string, oldString: string, replaceAll = false): string[] | null {
  if (!oldString) return null;
  const found = spans(text, oldString, replaceAll);
  if (!found.length) return null;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, scriptKind(file));
  const names = new Set<string>();
  for (const [start, end] of found) if (!addNamesAt({ source, start, end, names })) return null;
  return [...names];
}
