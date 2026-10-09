// @types/node here predates node:sqlite; this covers the little of it the search index uses.
declare module "node:sqlite" {
  type Value = string | number | bigint | null | Uint8Array;
  export class StatementSync {
    all(...params: Value[]): Record<string, Value>[];
    get(...params: Value[]): Record<string, Value> | undefined;
    run(...params: Value[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
