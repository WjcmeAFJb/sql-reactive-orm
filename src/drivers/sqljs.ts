import initSqlJs, { type BindParams, type Database, type SqlJsStatic } from "sql.js";
import type { Driver, RunResult } from "../driver.js";

export interface SqlJsDriverOptions {
  locateFile?: (file: string) => string;
  wasmBinary?: ArrayBuffer;
  data?: Uint8Array;
}

/**
 * Driver backed by sql.js — pure WASM, works in Node and the browser.
 * All operations are synchronous under the hood; we still return Promises
 * for consistency with the ORM's async-first API.
 */
export class SqlJsDriver implements Driver {
  private _db: Database | null = null;
  private readonly _init: Promise<Database>;

  constructor(options: SqlJsDriverOptions = {}) {
    const initArg: { locateFile?: (file: string) => string; wasmBinary?: ArrayBuffer } = {};
    if (options.locateFile) initArg.locateFile = options.locateFile;
    if (options.wasmBinary) initArg.wasmBinary = options.wasmBinary;
    this._init = initSqlJs(initArg).then((SQL: SqlJsStatic) => {
      const db = new SQL.Database(options.data);
      this._db = db;
      return db;
    });
  }

  static async open(options: SqlJsDriverOptions = {}): Promise<SqlJsDriver> {
    const d = new SqlJsDriver(options);
    await d._ready();
    return d;
  }

  private async _ready(): Promise<Database> {
    if (this._db) return this._db;
    return this._init;
  }

  async exec(sql: string): Promise<void> {
    const db = await this._ready();
    db.exec(sql);
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
    const db = await this._ready();
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params as BindParams);
      stmt.step();
    } finally {
      stmt.free();
    }
    const changes = db.getRowsModified();
    // last_insert_rowid() is 0 if no row was inserted in this connection yet —
    // that's the right answer for INSERT sql with 0 rows, and it's the last
    // rowid otherwise.
    const last = db.exec("SELECT last_insert_rowid()");
    const lastId = last[0]?.values[0]?.[0];
    return {
      changes,
      lastInsertRowid: typeof lastId === "number" || typeof lastId === "bigint" ? lastId : 0,
    };
  }

  async all<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const db = await this._ready();
    const stmt = db.prepare(sql);
    const rows: T[] = [];
    try {
      stmt.bind(params as BindParams);
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  async close(): Promise<void> {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }

  /** Return the database as a binary blob — useful for persistence. */
  async export(): Promise<Uint8Array> {
    const db = await this._ready();
    return db.export();
  }
}
