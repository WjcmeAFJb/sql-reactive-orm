/**
 * Minimal SQL driver surface the ORM depends on. Both the Node driver
 * (better-sqlite3) and the browser driver (sql.js) are sync under the hood,
 * but everything returns a Promise so the ORM layer stays consistent and can
 * later swap in a truly async driver (libsql, turso, workers) without
 * rewriting call sites.
 */

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Driver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly unknown[]): Promise<RunResult>;
  all<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  close?(): Promise<void>;
}
