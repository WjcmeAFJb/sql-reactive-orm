# Integration with sql-git

[`sql-git`](https://github.com/WjcmeAFJb/sql-git) is a distributed
SQLite with per-peer action logs and rebase-style conflict resolution.
The stored state is a normal in-memory SQLite; sql-reactive-orm plugs
in on the read side.

**Division of labour:**

- **Writes go through sql-git actions.** `store.submit("create_account",
  params)` — these land in the log, replicate to other peers, rebase
  on sync.
- **Reads go through the ORM.** `orm.findAll(Account, …)`,
  `orm.sqlQuery(…)` — typed, reactive, re-run on invalidation.

## Why this combo

sql-git's `Store.db` is a live SQLite that's replaced on every peer
sync (the rebased db becomes the new `store.db`). The ORM's reactive
model — fields as Promises, queries as observables — composes cleanly
because invalidation is *explicit*. After each sync, tell the ORM "the
world moved" and every watching query refetches.

## Wiring the driver

sql-git doesn't use the ORM's driver for its own writes. The ORM's
`Driver` is just a read path. You point it at `store.db.raw` (the
underlying `sqlite3-read-tracking` handle) through a custom adapter:

```ts
// orm-driver.ts
import type { Driver } from "sql-reactive-orm";
import type { Db } from "sql-git"; // sql-git's Db class wraps a raw handle

export function createGitDriver(getDb: () => Db | null): Driver {
  return {
    exec: async (sql) => void getDb()!.raw.exec(sql),
    run: async (sql, params = []) => {
      const raw = getDb()!.raw;
      const r = params.length ? raw.exec(sql, params as never) : raw.exec(sql);
      const changes = Number(raw.exec("SELECT changes()")[0]?.values[0]?.[0] ?? 0);
      const lastRes = raw.exec("SELECT last_insert_rowid()");
      const last = lastRes[0]?.values[0]?.[0];
      return {
        changes,
        lastInsertRowid:
          typeof last === "number" || typeof last === "bigint" ? last : 0,
      };
    },
    all: async (sql, params = []) => {
      const raw = getDb()!.raw;
      const res = params.length ? raw.exec(sql, params as never) : raw.exec(sql);
      if (!res.length) return [];
      const { columns, values } = res[0];
      return values.map((row) =>
        Object.fromEntries(columns.map((c, i) => [c, row[i]])),
      ) as never;
    },
  };
}
```

A couple of things to notice:

- `getDb()` is a *closure*, not a snapshot. `store.db` is reassigned
  after every sync; the getter returns the live reference. That way
  the same ORM instance survives every sync.
- `run` uses `raw.exec` (not `prepare` + `step`). The read-tracking
  build has a subtle hang if you open a statement while another is
  still mid-step on the same connection; `exec` takes params and runs
  in one shot.

## Invalidation after submits

sql-git's mutations don't go through `orm.driver.run`, so the
reactive wrapper won't detect them automatically. Fire invalidations
yourself after every successful submit:

```ts
import { Orm } from "sql-reactive-orm";
import type { Store } from "sql-git";

export async function wrappedSubmit(
  store: Store,
  orm: Orm,
  name: string,
  params: unknown,
) {
  await store.submit(name, params);
  // Invalidate the tables your actions touch. Over-invalidation is
  // cheap — any SqlQuery that's a no-op on refetch returns identical
  // rows, row-by-row diffing preserves identity, React doesn't
  // re-render.
  for (const table of ["accounts", "categories", "transactions"]) {
    orm.invalidate(table);
  }
}
```

For a bit more rigor, trace the action's writes via
`sqlite3-read-tracking`'s `getWriteLog()` and invalidate exactly those
tables. The cost of blanket invalidation is one unnecessary SELECT
per SqlQuery per submit, which is negligible for CRUD workloads.

## Invalidation after sync

`store.sync()` can apply many master actions at once and also swap
`store.db` for the rebased one. Treat it as "everything might have
changed":

```ts
async function wrappedSync(store: Store, orm: Orm) {
  const report = await store.sync({ onConflict });
  for (const table of ["accounts", "categories", "transactions"]) {
    orm.invalidate(table);
  }
  return report;
}
```

## Reference implementation

The [`demo-opfs2/`](https://github.com/WjcmeAFJb/sql-git/tree/master/demo-opfs2)
directory in sql-git is a complete app on this pattern: OPFS-backed
sql-git Store, sql-reactive-orm over the top, React 18 `observer` leaf
components (StatsPanel, CategoryBreakdown) with live-updating aggregate
queries, SQL console that routes mutations through an `exec_sql`
action, conflict bar that previews queued mitigations via
`ctx.rebasedDb`.

Key files:

- `src/lib/orm.ts` — the custom driver + ORM init.
- `src/hooks/use-orm.ts` — creates one ORM per Store, calls
  `invalidateBank` on every tick.
- `src/components/StatsPanel.tsx`,
  `src/components/CategoryBreakdown.tsx` — `observer`-wrapped leaves
  reading `useBankQuery` (which wraps `orm.sqlQuery`).

## Next

- [Reactivity model](/concepts/reactivity)
- [Aggregate queries](/concepts/aggregates)
