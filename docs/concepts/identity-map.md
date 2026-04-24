# Identity map

Every entity instance is cached by primary key. Look up the same id
twice, get the same object:

```ts
const a = await orm.find(Account, 1);
const b = await orm.find(Account, 1);
console.log(a === b); // true
```

## Why

Object identity is how React (and MobX) decides "did this thing
change?" If `Query.value[0]` is literally the same object reference as
last render, React's reconciler short-circuits. That ripples down: a
sibling `Row` with a stable `tx` prop doesn't re-render.

## What's cached

`Orm._identity` is a `Map<string, Map<unknown, Entity>>` — one inner
map per entity class, keyed by primary key value.

Populated by:

- `orm.find(cls, id)` — if not in the map, creates an instance and
  stores it.
- `orm.findAll(cls, …)` — fills for every row in the result.
- `orm.insert(cls, data)` — after insert, the new row is fetched,
  wrapped, and cached.
- Relation resolution (`account.transactions`) — every hydrated
  Transaction is cached by id.

## What isn't cached

- **Raw rows from `orm.sqlQuery`.** Those are plain observable objects;
  they don't go through the identity map. (If you need entity identity
  for aggregate results, switch to `findAll` or re-hydrate via `find`
  in the consumer.)
- **Anything you explicitly `clearCaches()`.** Call this when the
  underlying db has been replaced out-of-band (e.g., sql-git's
  peer-sync swap) — subsequent reads hydrate fresh.

## Interacting with the cache

```ts
// Peek without hitting the DB
const cached: Account | undefined = orm.peek(Account, 1);

// Drop every entity's row cache (keeps identity, forces re-fetch on next read)
orm.clearCaches();

// Drop every cached Query / SqlQuery (next findAll / sqlQuery returns a fresh one)
orm.clearQueryCache();
```

::: warning
Calling `clearQueryCache()` disposes every cached Query. If you're
holding references from an earlier `orm.findAll(...)` in a
long-lived component, they become stale (they still return their last
fulfilled rows but won't refetch). Let the component recompute the
Query when appropriate — e.g., key it by a `tick` state that bumps on
clear.
:::

## Pitfalls

### String vs numeric primary keys

The identity map uses `Map`'s default equality — `1 !== "1"`. Make sure
every callsite uses the same type. Use numeric ids throughout unless
you have a reason (e.g., sql-git's action params where string ids keep
things deterministic).

### Surgical deletes

If you delete an entity via `orm.driver.run("DELETE FROM accounts
WHERE id = 5")`, the row cache will eventually be refreshed by the
invalidation bus — but any already-held reference to the Account
remains in the identity map as a "tombstone." Calling `use(account.name)`
on a deleted entity may throw during the refresh cycle. Prefer
`orm.delete(entity)`, which removes the entity from the identity map
cleanly.

## See also

- [Reactivity model](/concepts/reactivity)
- [Entities & relations](/concepts/entities)
