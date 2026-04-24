# Drivers

The ORM sits on a minimal three-method driver. You can swap the backing
SQLite for anything that can run SQL and return results.

## The interface

```ts
interface Driver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly unknown[]): Promise<RunResult>;
  all<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  close?(): Promise<void>;
}

interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}
```

That's the whole surface. Any backend that satisfies this is an ORM
driver.

## The reactive wrapper

`orm.driver` isn't the raw driver — it's the wrapped version:

```ts
// orm.ts (simplified)
this.rawDriver = driver;
this.driver = wrapReactive(driver, (tables) => {
  for (const t of tables) this._notifyTable(t);
});
```

`wrapReactive` intercepts `run` / `exec`, parses the SQL for mutated
tables (INSERT / UPDATE / DELETE / REPLACE / DROP TABLE / ALTER TABLE),
and fires invalidations after each call. Inside a transaction
(`BEGIN ... COMMIT`), invalidations are deferred until COMMIT.

Reads (`all`) pass through unchanged. No wrapping overhead on queries.

## `orm.rawDriver` escape hatch

If you want to write to the db *without* reactive invalidation — bulk
seeds, background migrations, admin tooling — use `orm.rawDriver`
directly:

```ts
await orm.rawDriver.exec(fs.readFileSync("seed.sql", "utf8"));
```

Consumers see no update until you invalidate manually.

## Built-in: `SqlJsDriver`

```ts
import { SqlJsDriver } from "sql-reactive-orm/drivers/sqljs";

// Browser
const driver = await SqlJsDriver.open({
  locateFile: () => "/sql-wasm.wasm",
});

// Node (auto-resolves the wasm via `require.resolve("sql.js/dist/sql-wasm.wasm")`)
const driver = await SqlJsDriver.open();

// Existing data
const driver = await SqlJsDriver.open({ data: await fetchDbBytes() });
```

Sync under the hood; wraps each call in a resolved Promise for API
consistency.

Helper:

```ts
const bytes = await driver.export(); // Uint8Array of the whole db
```

## Writing a custom driver

An in-memory adapter for tests is ~60 lines. A better-sqlite3 adapter
for Node is less. Anything where you can execute `sql` with `params`
and get rows back qualifies.

```ts
// better-sqlite3 driver (sketch)
import Database from "better-sqlite3";
import type { Driver } from "sql-reactive-orm";

export function createBetterSqliteDriver(db: Database.Database): Driver {
  return {
    exec: async (sql) => void db.exec(sql),
    run: async (sql, params = []) => {
      const info = db.prepare(sql).run(...params);
      return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
    },
    all: async (sql, params = []) =>
      db.prepare(sql).all(...params) as never,
    close: async () => void db.close(),
  };
}
```

Plug it in:

```ts
const orm = new Orm(createBetterSqliteDriver(new Database("./app.sqlite")));
```

## Custom driver for sql-git

sql-git's `Store.db` is a special case: mutations bypass `orm.driver`
(they go through `store.submit`), so the reactive wrapper can't detect
them. Pair a custom read-only driver with manual `orm.invalidate(...)`
after each submit. See [Integration with sql-git](/guide/sql-git) for
the full recipe.

## See also

- [API — Driver](/api/driver)
- [Integration with sql-git](/guide/sql-git)
