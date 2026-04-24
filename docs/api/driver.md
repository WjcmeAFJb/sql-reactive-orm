# Driver

The storage surface the ORM runs against. Three methods.

```ts
export interface Driver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly unknown[]): Promise<RunResult>;
  all<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
  close?(): Promise<void>;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}
```

- **`exec`** — run SQL, ignore result. Typically schema DDL /
  transaction control (`BEGIN` / `COMMIT`).
- **`run`** — run a mutation, return row count + last inserted id.
- **`all`** — run a SELECT, return rows as `Record<string, unknown>[]`
  (the generic is for typed consumers).
- **`close`** — optional. Called by `orm.close()`.

## Built-in: `SqlJsDriver`

```ts
import { SqlJsDriver } from "sql-reactive-orm/drivers/sqljs";
```

```ts
interface SqlJsDriverOptions {
  locateFile?: (file: string) => string;
  wasmBinary?: ArrayBuffer;
  data?: Uint8Array;
}
```

- **`locateFile(name)`** — return the URL / path for the `name`d
  support file. Used to point at the bundler-resolved `sql-wasm.wasm`.
- **`wasmBinary`** — alternative to `locateFile`; pass the bytes
  directly.
- **`data`** — pre-existing database bytes (from a download, a file,
  or a previous `driver.export()`).

Methods:

- **`SqlJsDriver.open(opts?)`** — static factory returning a resolved
  instance.
- **`driver.export()`** — `Uint8Array` of the whole db.
- **`driver.close()`** — closes the connection.

## `wrapReactive`

Low-level. Used by `new Orm(driver)` internally; exported for advanced
users who want to layer their own wrappers:

```ts
import { wrapReactive, detectMutatedTables } from "sql-reactive-orm";

const reactive = wrapReactive(rawDriver, (tables: Set<string>) => {
  for (const t of tables) myBus.notify(t);
});
```

The wrapper:

- On `run` / `exec`, calls `detectMutatedTables(sql)` to extract
  INSERT / UPDATE / DELETE / REPLACE / DROP TABLE / ALTER TABLE targets.
- Inside `BEGIN ... COMMIT`, accumulates the set and fires once on
  `COMMIT`. Dropped on `ROLLBACK`.
- `all` is a direct delegate.

## Writing a custom driver

Any backend that can run SQL qualifies. See
[Drivers](/concepts/drivers) for a better-sqlite3 sketch.

Invariants:

- `exec` returns when all statements complete. Don't swallow errors.
- `run` must return accurate `changes` (use `sqlite3_changes()` / the
  driver's equivalent).
- `all` returns rows in SELECT order (for consumer stability).
- `close` (if defined) makes subsequent calls throw.

## See also

- [Drivers](/concepts/drivers)
- [Integration with sql-git](/guide/sql-git)
