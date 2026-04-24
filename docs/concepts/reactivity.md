# Reactivity model

Every read is a MobX observable. Every write that goes through the
reactive driver invalidates the tables it touches. React's `use()` hook
ties the two together.

## The observable graph

When you call `orm.findAll(Account, …)`:

1. The ORM compiles the query plan and builds a `Query<Account[]>`
   instance.
2. Internally it subscribes to the tables it reads (default: every
   table that appears in the effective SQL; overridable with
   `watch: [...]`).
3. It kicks off a `driver.all(sql, params)` to fetch rows. Each row is
   wrapped in `observable.object` and plugged into the identity map.
4. The `Query` itself has a `status` observable (`"pending" →
   "fulfilled" | "rejected"`) and a `value` observable (the row array).
5. Components `use()`-ing the Query suspend; when status flips to
   `"fulfilled"`, React resumes them.

On the next invalidation (another `run`/`exec` on the reactive driver
that names one of the watched tables), the Query re-fetches, diffs the
new rows against the old, and patches individual row observables in
place. Components that only read the fields that *actually changed*
re-render.

## Field promises

```ts
declare class Account extends Entity {
  declare name: Promise<string>;
  declare transactions: Promise<Transaction[]>;
}
```

Each field is a lazy Promise-like value:

- On first `await account.name` / `use(account.name)`, the ORM fires a
  `SELECT name FROM accounts WHERE id = ?` lookup (or hits the cache
  from `_applyRow` if an earlier query populated it).
- The Promise is a `TrackedPromise` — `.status`, `.value`, `.reason` are
  all observables. React's `use()` reads `.status`, suspending while
  `"pending"`.
- After the lookup, `account.name` stays fulfilled forever. Subsequent
  `use(account.name)` resolves synchronously.

When invalidation refetches the Account's row, `_applyRow` only swaps
the `_row` observable if the underlying values changed. React re-renders
only components that `use()`-ed fields whose values moved.

## Query invalidation

Three things invalidate queries:

1. **Driver-detected mutations.** `orm.driver.run("UPDATE transactions
   …")` — the reactive wrapper parses the SQL, extracts mutated tables,
   and fires table-scoped notifications after the run resolves.
2. **Transaction commits.** Inside `orm.transaction(async () => { ... })`,
   invalidations are deferred and flushed on COMMIT. ROLLBACK drops
   them. One refetch per table per transaction, not per statement.
3. **Manual `orm.invalidate(table)`.** For cases where the ORM's driver
   wrapper isn't the mutation path — see
   [Integration with sql-git](/guide/sql-git).

## Why this is fast

- **Positional + keyed diff.** `SqlQuery` diffs new rows against old by
  position (default) or by a `keyBy` function. Rows that didn't move
  retain their object identity, so components that read them don't
  re-render.
- **Deep patch.** Nested objects (JSON columns, relations) are patched
  recursively. Only the leaf values that changed trigger observers.
- **Stale-while-revalidate.** Refetches don't clear the observable
  array first — the old rows stay visible while the new ones arrive,
  then are patched in place. No Suspense flash on mutation.

## The whole write loop

```
user clicks "Add transaction"
  ↓
await orm.insert(Transaction, {...})
  ↓
orm.driver.run("INSERT INTO transactions …")
  ↓
reactive wrapper sees "INSERT INTO transactions"
  ↓
orm._notifyTable("transactions")
  ↓
   → _refreshCachedRowsFor("transactions")  // patches entity rows in place
   → _refreshCachedRelationsFor("transactions") // re-runs hasMany/belongsTo SELECTs
   → subscribers on "transactions" (SqlQuery + Query) re-execute
  ↓
MobX notifies observers of changed values
  ↓
React re-renders components that `use()`-ed the changed fields
```

No extra bookkeeping. If you can describe the data change in terms of
"which tables got written," the graph updates correctly.

## See also

- [Identity map](/concepts/identity-map)
- [Aggregate queries](/concepts/aggregates)
