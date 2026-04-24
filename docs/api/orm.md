# Orm

The central class. Owns the driver, the entity registry, the identity
map, and the invalidation bus.

```ts
import { Orm } from "sql-reactive-orm";

const orm = new Orm(driver);
await orm.register(Account, Transaction);
```

## Constructor

```ts
new Orm<DB = unknown>(driver: Driver)
```

`DB` is the Kysely schema type for type-safe builders
(`orm.sqlQuery((db) => db.selectFrom(...))`). You get it from
[codegen](/guide/codegen) or by hand-writing a `DB` interface.

## Instance

```ts
orm.driver       // reactive-wrapped Driver (use this for app mutations)
orm.rawDriver    // un-wrapped Driver (no invalidation — admin use)
orm.kysely       // Kysely<DB> — compile-only (execution still goes through driver)
```

## Entity registration

```ts
await orm.register(Account, Transaction, Category);
```

Idempotent — safe to call multiple times with overlapping sets.

## Queries

```ts
orm.findAll<T>(cls, opts?)    → Query<T[]>
orm.findFirst<T>(cls, opts?)  → Query<T | null>
orm.find<T>(cls, id, opts?)   → Query<T | null>
orm.sqlQuery<T>(sql, params?, opts?) → SqlQuery<T>
orm.sqlQuery<T>(builder, opts?)      → SqlQuery<T>
```

Every query returns a Promise-like observable. Inside `use()`, they
suspend until fulfilled. See
[Query / SqlQuery](/api/queries) for the full shape of the return
types.

### Options

```ts
interface QueryOptions {
  where?: WhereClause;
  orderBy?: OrderBy[];
  limit?: number;
  offset?: number;
  with?: WithClause;  // eager-load relations
}
```

```ts
orm.findAll(Transaction, {
  where: { amount: { lt: 0 } },
  orderBy: [["date", "desc"]],
  with: { account: true, category: true },
  limit: 50,
});
```

## Mutations

```ts
await orm.insert(cls, data);   // returns T (the inserted entity)
await orm.update(entity, patch);
await orm.delete(entity);
```

All three go through `orm.driver` so the reactive bus sees them.

## Transactions

```ts
await orm.transaction(async () => {
  await orm.insert(Transaction, {...});
  await orm.driver.run("UPDATE accounts SET balance = balance - ?", [100]);
});
```

Properties:

- Serialised: concurrent `transaction(…)` calls await prior ones.
  SQLite allows only one transaction per connection.
- Invalidations are batched and fired once on COMMIT; dropped on
  ROLLBACK.

## Manual invalidation

```ts
orm.invalidate("transactions");
```

For when mutations happen outside `orm.driver` (e.g., sql-git's
`store.submit`). Every Query / SqlQuery watching the named table
refetches.

## Cache control

```ts
orm.clearCaches();        // drop every cached entity row (identity preserved)
orm.clearQueryCache();    // drop every cached Query / SqlQuery
orm.peek(cls, id);        // read the identity map without a DB hit
await orm.settle();       // wait for in-flight background refreshes to finish
```

## Lifecycle

```ts
await orm.close();
```

Closes the underlying driver (if it provides a `close` method).

## See also

- [Entity](/api/entity)
- [Query / SqlQuery](/api/queries)
- [Driver](/api/driver)
