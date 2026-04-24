# Query / SqlQuery

Both types are **Promise-like + MobX-observable**. They resolve into
arrays (or a single row for `findFirst` / `find`); React's `use()` hook
reads `.status` and suspends until fulfilled.

## `Query<T>`

Returned by `orm.findAll`, `orm.findFirst`, `orm.find`.

```ts
interface Query<T> extends PromiseLike<T> {
  readonly status: "pending" | "fulfilled" | "rejected";
  readonly value: T | undefined;
  readonly reason: unknown;
  refetch(): Promise<T>;
  dispose(): void;
}
```

- `.status / .value / .reason` are MobX observables.
- `.then(...)` awaits the current fetch — implements `PromiseLike`.
- `.refetch()` forces a fresh run.
- `.dispose()` unsubscribes from the invalidation bus.

## `SqlQuery<T>`

Returned by `orm.sqlQuery(...)`.

```ts
class SqlQuery<T> implements Promise<T[]> {
  readonly status: "pending" | "fulfilled" | "rejected";
  readonly value: IObservableArray<T>; // stable per-row object identity
  readonly reason: unknown;
  then(...): Promise<T[]>;
  catch(...): Promise<T[]>;
  finally(...): Promise<T[]>;
  refetch(): Promise<T[]>;
  dispose(): void;
}
```

Key differences from `Query`:

- `value` is always a MobX `IObservableArray` — even before fulfillment
  it's `[]`. Patched in place on refetch.
- Rows are wrapped in `observable.object` so per-field changes are
  tracked.

## Consumption patterns

### React 19 — `use()`

```tsx
const txs = use(orm.findAll(Transaction, { orderBy: [["id", "desc"]] }));
const rows = use(orm.sqlQuery((db) => db.selectFrom("accounts").selectAll()));
```

### React 18 — `observer`

```tsx
import { observer } from "mobx-react-lite";
import { useMemo } from "react";

const TransactionList = observer(() => {
  const q = useMemo(
    () => orm.findAll(Transaction, { orderBy: [["id", "desc"]] }),
    [],
  );
  if (q.status === "pending") return <Spinner />;
  if (q.status === "rejected") return <Error err={q.reason} />;
  return <ul>{q.value!.map(tx => <Row key={tx.id} tx={tx} />)}</ul>;
});
```

For `observer` to know when to re-render, the reads it tracks must
happen during the render. `q.status` and `q.value` are observables.

### Vanilla (Node, tests)

```ts
const txs = await orm.findAll(Transaction, { orderBy: [["id", "desc"]] });
```

Awaited — `status` transitions are irrelevant; you get the array.

## Caching

`orm.findAll(Transaction, opts)` computes a cache key from
`(kind, cls, opts)`. Two calls with the same options return the same
`Query` instance. That's how `use(orm.findAll(...))` across re-renders
returns the stable thenable React 19 expects.

Dispose by:

- `query.dispose()` — manual.
- `orm.clearQueryCache()` — sweep.
- Automatically when the Orm is closed.

## See also

- [Reactivity model](/concepts/reactivity)
- [Aggregate queries](/concepts/aggregates)
- [Orm](/api/orm)
