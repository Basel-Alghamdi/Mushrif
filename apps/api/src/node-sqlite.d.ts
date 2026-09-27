declare module "node:sqlite" {
  export class StatementSync {
    run(...values: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...values: unknown[]): Record<string, unknown> | undefined;
    all(...values: unknown[]): Record<string, unknown>[];
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
