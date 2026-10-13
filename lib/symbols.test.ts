import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isSourceFile, NEST_LINES, statementNames, symbolsFor } from "./symbols";

// The imports go in as strings, so lib/import-check.ts doesn't take them for this file's own.
const IMPORTS = ['import { a } from "./a";', 'import b from "./b";'].join("\n");
const SRC = `${IMPORTS}

// Says hi.
export function hello(name: string) {
  return \`hi \${name}\`;
}

export const Panel = () => {
  return null;
};

class Store {
  get() {
    return 1;
  }
}

type Id = string;
interface Shape {
  id: Id;
}

export default function () {
  return 2;
}
`;

describe("isSourceFile", () => {
  it("reads TypeScript and JavaScript, not the rest", () => {
    for (const f of ["a.ts", "a.tsx", "a.js", "a.jsx", "a.mjs", "a.cjs", "a.mts", "A.TS"]) expect(isSourceFile(f)).toBe(true);
    for (const f of ["a.css", "a.md", "a.json", "Makefile"]) expect(isSourceFile(f)).toBe(false);
  });
});

describe("symbolsFor", () => {
  it("names the function, component, class, type or interface an edit sits in", () => {
    expect(symbolsFor("/x.ts", SRC, "return `hi ${name}`;")).toEqual(["hello"]);
    expect(symbolsFor("/x.ts", SRC, "return null;")).toEqual(["Panel"]);
    expect(symbolsFor("/x.ts", SRC, "return 1;")).toEqual(["Store"]);
    expect(symbolsFor("/x.ts", SRC, "type Id = string;")).toEqual(["Id"]);
    expect(symbolsFor("/x.ts", SRC, "id: Id;")).toEqual(["Shape"]);
    expect(symbolsFor("/x.ts", SRC, "return 2;")).toEqual(["default"]);
  });

  it("counts a statement's leading comment as its own", () => {
    expect(symbolsFor("/x.ts", SRC, "// Says hi.")).toEqual(["hello"]);
  });

  it("leaves the next statement out when the edit only ends on blank lines before it", () => {
    expect(symbolsFor("/x.ts", SRC, "  return `hi ${name}`;\n}\n\n")).toEqual(["hello"]);
  });

  it("names every statement an edit spans", () => {
    expect(symbolsFor("/x.ts", SRC, "}\n\nexport const Panel")).toEqual(["hello", "Panel"]);
  });

  it("never claims imports", () => {
    expect(symbolsFor("/x.ts", SRC, 'import b from "./b";')).toEqual([]);
    expect(symbolsFor("/x.ts", SRC, 'import b from "./b";\n\n// Says hi.')).toEqual(["hello"]);
    expect(symbolsFor("/x.ts", 'export { a } from "./a";\n', "export { a }")).toEqual([]);
  });

  it("looks at every match when the edit replaces them all, and only the first otherwise", () => {
    expect(symbolsFor("/x.ts", SRC, "return", true)).toEqual(["hello", "Panel", "Store", "default"]);
    expect(symbolsFor("/x.ts", SRC, "return")).toEqual(["hello"]);
  });

  it("gives up on the symbols (the whole file) when old_string is empty or missing, or a statement has no name", () => {
    expect(symbolsFor("/x.ts", SRC, "")).toBeNull();
    expect(symbolsFor("/x.ts", SRC, "not in the file")).toBeNull();
    expect(symbolsFor("/x.js", "app.listen(3000);\n", "3000")).toBeNull();
  });

  it("parses JSX, plain JS and module files", () => {
    expect(symbolsFor("/x.tsx", "export function Card() {\n  return <div>hi</div>;\n}\n", "<div>hi</div>")).toEqual(["Card"]);
    expect(symbolsFor("/x.jsx", "const Card = () => <b>x</b>;\n", "<b>x</b>")).toEqual(["Card"]);
    expect(symbolsFor("/x.cjs", "function main() {\n  run();\n}\n", "run();")).toEqual(["main"]);
  });
});

describe("statementNames", () => {
  const first = (src: string) => statementNames(ts.createSourceFile("/x.ts", src, ts.ScriptTarget.Latest).statements[0] as ts.Statement);

  it("names each declaration, destructured ones too", () => {
    expect(first("const a = 1, b = 2;")).toEqual(["a", "b"]);
    expect(first("const { a, b: [c, , d] } = x;")).toEqual(["a", "c", "d"]);
    expect(first("let [e] = x;")).toEqual(["e"]);
  });

  it("names enums, namespaces and default exports", () => {
    expect(first("enum Color { Red }")).toEqual(["Color"]);
    expect(first("namespace NS { export const x = 1; }")).toEqual(["NS"]);
    expect(first("export default App;")).toEqual(["default"]);
    expect(first("export default class {}")).toEqual(["default"]);
  });

  it("finds no name for an anonymous class or function that isn't the default, or a bare statement", () => {
    expect(first("import x = require('x');")).toEqual([]);
    expect(first("if (x) y();")).toBeNull();
    // Only parses with an error, but a thread can write it.
    expect(first("export function () {}")).toBeNull();
  });
});

// Lines enough to push a symbol past NEST_LINES.
const pad = (make: (i: number) => string, n = NEST_LINES) => Array.from({ length: n }, (_, i) => make(i)).join("\n");

// Shaped like components/Board.tsx: one long component whose hooks, handlers and JSX return each get a claim.
const REACT = 'import { useEffect } from "react";';
const BOARD = `${REACT}

export function Board() {
  const [open, setOpen] = useState(false);
  const { toast, notify } = useToast();
  useBoardEvents();
  useEffect(() => {
    load(1);
  }, []);
  useEffect(() => {
    load(2);
  }, []);
  const moveFocus = (dir: number) => {
    focus(dir);
  };
  function paletteItems() {
    return [];
  }
${pad((i) => `  const filler${i} = ${i};`)}
  return (
    <div className="board">
      <Header title="Weft" />
      {open && <Dialog onClose={() => setOpen(false)} />}
      {label}
      plain words
      <>
        <Fragmented />
      </>
      <main>
${pad((i) => `        <Item n={${i}} />`)}
      </main>
    </div>
  );
}
`;

describe("symbolsFor inside long symbols", () => {
  it("claims the named statement inside a long component", () => {
    expect(symbolsFor("/b.tsx", BOARD, "focus(dir);")).toEqual(["Board/moveFocus"]);
    expect(symbolsFor("/b.tsx", BOARD, "return [];")).toEqual(["Board/paletteItems"]);
    expect(symbolsFor("/b.tsx", BOARD, "const filler7 = 7;")).toEqual(["Board/filler7"]);
  });

  it("names a destructuring by its first name and a hook call by the hook", () => {
    expect(symbolsFor("/b.tsx", BOARD, "useState(false)")).toEqual(["Board/open"]);
    expect(symbolsFor("/b.tsx", BOARD, "useToast()")).toEqual(["Board/toast"]);
    expect(symbolsFor("/b.tsx", BOARD, "useBoardEvents();")).toEqual(["Board/useBoardEvents"]);
  });

  it("numbers repeats by their order among their kind", () => {
    expect(symbolsFor("/b.tsx", BOARD, "load(1);")).toEqual(["Board/useEffect#1"]);
    expect(symbolsFor("/b.tsx", BOARD, "load(2);")).toEqual(["Board/useEffect#2"]);
  });

  it("splits a long JSX return by its children, and a long child again", () => {
    expect(symbolsFor("/b.tsx", BOARD, 'title="Weft"')).toEqual(["Board/return/Header"]);
    expect(symbolsFor("/b.tsx", BOARD, "setOpen(false)")).toEqual(["Board/return/Dialog"]);
    expect(symbolsFor("/b.tsx", BOARD, "{label}")).toEqual(["Board/return/expression"]);
    expect(symbolsFor("/b.tsx", BOARD, "plain words")).toEqual(["Board/return/text"]);
    expect(symbolsFor("/b.tsx", BOARD, "<Fragmented />")).toEqual(["Board/return/fragment"]);
    expect(symbolsFor("/b.tsx", BOARD, "<Item n={42} />")).toEqual(["Board/return/main/Item#43"]);
  });

  it("claims each statement an edit spans", () => {
    expect(symbolsFor("/b.tsx", BOARD, "useBoardEvents();\n  useEffect(() => {\n    load(1);")).toEqual(["Board/useBoardEvents", "Board/useEffect#1"]);
  });

  it("claims the long symbol itself when the edit touches its own lines", () => {
    expect(symbolsFor("/b.tsx", BOARD, "export function Board() {")).toEqual(["Board"]);
    expect(symbolsFor("/b.tsx", BOARD, '<div className="board">')).toEqual(["Board/return"]);
    expect(symbolsFor("/b.tsx", BOARD, "  );\n}")).toEqual(["Board"]);
  });

  it("leaves a symbol of NEST_LINES lines whole", () => {
    const fits = `function fits() {\n${pad((i) => `  const v${i} = ${i};`, NEST_LINES - 2)}\n}\n`;
    expect(symbolsFor("/f.ts", fits, "const v3 = 3;")).toEqual(["fits"]);
    const over = `function over() {\n${pad((i) => `  const v${i} = ${i};`, NEST_LINES - 1)}\n}\n`;
    expect(symbolsFor("/f.ts", over, "const v3 = 3;")).toEqual(["over/v3"]);
  });

  it("splits an arrow component with a JSX body, a wrapped default export and a long class", () => {
    const arrow = `export const Panel = () => (\n  <ul>\n${pad((i) => `    <li key={${i}} />`)}\n  </ul>\n);\n`;
    expect(symbolsFor("/p.tsx", arrow, "<li key={3} />")).toEqual(["Panel/li#4"]);
    const memo = `export default memo(function Big() {\n${pad((i) => `  const b${i} = ${i};`)}\n});\n`;
    expect(symbolsFor("/m.tsx", memo, "const b9 = 9;")).toEqual(["default/b9"]);
    const cls = `class Store {\n  constructor() {\n    this.x = 1;\n  }\n  load = () => {\n    go();\n  };\n  [Symbol.iterator]() {\n    return null;\n  }\n${pad((i) => `  m${i}() {}`)}\n}\n`;
    expect(symbolsFor("/s.ts", cls, "this.x = 1;")).toEqual(["Store/constructor"]);
    expect(symbolsFor("/s.ts", cls, "go();")).toEqual(["Store/load"]);
    expect(symbolsFor("/s.ts", cls, "return null;")).toEqual(["Store/[Symbol.iterator]"]);
    expect(symbolsFor("/s.ts", cls, "m5() {}")).toEqual(["Store/m5"]);
    const field = `class Big {\n  run = () => {\n${pad((i) => `    const f${i} = ${i};`)}\n  };\n${pad((i) => `  m${i}() {}`)}\n}\n`;
    expect(symbolsFor("/b.ts", field, "const f2 = 2;")).toEqual(["Big/run/f2"]);
  });

  it("names other statements inside a long function by their kind or the call they make", () => {
    const run = `async function run() {
  if (a) go();
  for (;;) go();
  for (const x of xs) go();
  while (a) go();
  try { go(); } catch {}
  switch (a) { default: go(); }
  ipcMain.handle("x", go);
  load().then(go);
  await fetchAll();
  fns[0]();
  x = 1;
  const {} = a;
  class Inner {}
  label: go();
  throw new Error("e");
${pad((i) => `  const r${i} = ${i};`)}
}
`;
    const label = (s: string) => symbolsFor("/r.ts", run, s)?.[0];
    expect(label("if (a) go();")).toBe("run/if");
    expect(label("for (;;) go();")).toBe("run/for#1");
    expect(label("for (const x of xs)")).toBe("run/for#2");
    expect(label("while (a)")).toBe("run/while");
    expect(label("try { go(); }")).toBe("run/try");
    expect(label("switch (a)")).toBe("run/switch");
    expect(label('ipcMain.handle("x", go);')).toBe("run/ipcMain.handle");
    expect(label("load().then(go);")).toBe("run/then");
    expect(label("await fetchAll();")).toBe("run/fetchAll");
    expect(label("fns[0]();")).toBe("run/expression#1");
    expect(label("x = 1;")).toBe("run/expression#2");
    expect(label("const {} = a;")).toBe("run/const");
    expect(label("class Inner {}")).toBe("run/Inner");
    expect(label("label: go();")).toBe("run/statement");
    expect(label('throw new Error("e");')).toBe("run/throw");
  });

  it("doesn't split a long statement with nothing inside to split, or one holding several declarations", () => {
    const sig = `function over(\n${pad((i) => `  a${i}: number,`)}\n): void;\n`;
    expect(symbolsFor("/o.ts", sig, "a3: number,")).toEqual(["over"]);
    const two = `const one = [\n${pad((i) => `  ${i},`)}\n], two = 2;\n`;
    expect(symbolsFor("/t.ts", two, "  7,")).toEqual(["one", "two"]);
    const iffy = `const big = cond\n${pad((i) => `  && x${i}`)};\n`;
    expect(symbolsFor("/i.ts", iffy, "&& x5")).toEqual(["big"]);
    const multi = `function multi() {\n  let p = [\n${pad((i) => `    ${i},`)}\n  ], q = 2;\n}\n`;
    expect(symbolsFor("/m.ts", multi, "    7,")).toEqual(["multi/p"]);
    const call = `const nums = compute(\n${pad((i) => `  ${i},`)}\n);\n`;
    expect(symbolsFor("/n.ts", call, "  7,")).toEqual(["nums"]);
  });
});
