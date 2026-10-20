// Minimal type declaration for next/dist/compiled/path-to-regexp, which ships without one.
// The library exports a CommonJS object with match, pathToRegexp, compile, parse and others;
// only `match` is used by lib/app-routes.test.ts to assert the proxy's matcher forms.
declare module "next/dist/compiled/path-to-regexp" {
  export function match(pattern: string): (path: string) => false | {
    path: string;
    index: number;
    params: Record<string, string | string[]>;
  };
}