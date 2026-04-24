# Aggregate queries

When a `findAll` isn't enough — joins, sums, `WITH RECURSIVE`, window
functions — use `orm.sqlQuery`. Same reactivity model; any SQL you can
write.

## Two surfaces

### Raw SQL

```ts
const rows = orm.sqlQuery<{ category: string; total: number }>(
  `SELECT c.name AS category, SUM(t.amount) AS total
     FROM transactions t
     JOIN categories c ON c.id = t.categoryId
    WHERE t.amount < 0
    GROUP BY c.id`,
);
```

Pass the row shape as the generic. `rows` is a `SqlQuery<{...}>` — a
Promise-like observable you can drop into `use(rows)`.

### Kysely builder

```ts
import { sql } from "kysely";

const rows = orm.sqlQuery((db) =>
  db
    .selectFrom("transactions as t")
    .innerJoin("categories as c", "c.id", "t.categoryId")
    .where("t.amount", "<", 0)
    .select(["c.id", "c.name"])
    .select((eb) => eb.fn.sum<number>("t.amount").as("total"))
    .groupBy("c.id"),
  { keyBy: (r) => r.id },
);
```

Row shape inferred; full column autocomplete against your `DB` type
(the one emitted by `sql-reactive-orm-codegen` or hand-written).

## Options

```ts
interface SqlQueryOptions<T> {
  watch?: readonly string[];        // override auto-detected table list
  keyBy?: (row: T) => unknown;      // pair rows across refetches by key
}
```

- **`watch`** — by default the ORM parses `FROM <table>` / `JOIN <table>`
  out of the SQL string and subscribes to those tables. Override for
  hand-rolled queries where detection misses something (e.g., table
  names in a CTE).
- **`keyBy`** — rows are positionally diffed by default. With `keyBy`,
  the ORM pairs rows by key; re-ordered results preserve identity
  per-row.

## Re-runs

Every mutation to a watched table triggers a refetch of the
`SqlQuery`. The old result array isn't cleared — rows are patched in
place, preserving object identity for unchanged ones. React re-renders
only the leaf components whose read columns actually moved.

A 100-statement transaction fires one refetch per watched table, not
100 — the reactive wrapper defers invalidations to COMMIT.

## Example: reactive scalar

```ts
import { sql } from "kysely";

function NetWorth() {
  const [row] = use(
    orm.sqlQuery((db) =>
      db.selectNoFrom(
        sql<number>`
          COALESCE((SELECT SUM(initialBalance) FROM accounts), 0)
          + COALESCE((SELECT SUM(amount) FROM transactions), 0)
        `.as("total"),
      ),
    ),
  );
  return <strong>${row?.total ?? 0}</strong>;
}
```

When a transaction is added, the SQL runs again, returns a new scalar;
if the number didn't change, the row identity is preserved, React
short-circuits, the component doesn't re-render.

## Example: per-category breakdown

```ts
function CategoryBreakdown() {
  const rows = use(
    orm.sqlQuery(
      (db) =>
        db
          .selectFrom("categories as c")
          .leftJoin("transactions as t", "t.categoryId", "c.id")
          .select(["c.id", "c.name", "c.color"])
          .select((eb) => eb.fn.count<number>("t.id").as("tx_count"))
          .select((eb) =>
            eb.fn.coalesce(eb.fn.sum<number>("t.amount"), eb.val(0)).as("total"),
          )
          .groupBy("c.id")
          .orderBy("total", "desc"),
      { keyBy: (r) => r.id },
    ),
  );
  return (
    <ul>
      {rows.map((r) => (
        <BreakdownRow key={r.id} row={r} />
      ))}
    </ul>
  );
}

function BreakdownRow({ row }: { row: { id: number; name: string; total: number; tx_count: number } }) {
  return (
    <li>
      {row.name}: ${row.total.toFixed(2)} ({row.tx_count})
    </li>
  );
}
```

`keyBy: (r) => r.id` means each Category's row object is kept stable
across re-fetches. When a transaction is added to category 3, only
category 3's row moves; React re-renders only `BreakdownRow` for
`row.id === 3`.

## Falling back to raw driver

`orm.driver.all(sql, params)` is the escape hatch for one-off reads you
don't need to be reactive. It's the raw driver — no subscription, no
caching. Useful for:

- Debugging ("show me what's really in the db").
- Large exports that don't belong in the reactive graph.
- CLI / server-side batch reads where the caller manages invalidation.

```ts
const rows = await orm.driver.all<{ n: number }>(
  "SELECT COUNT(*) AS n FROM transactions",
);
console.log(rows[0]?.n);
```

## See also

- [Reactivity model](/concepts/reactivity)
- [API — Query / SqlQuery](/api/queries)
