# sql-reactive-orm

**Reactive ORM for SQLite, built on MobX.** Entity fields and relations
are Promises that hydrate on first read and re-settle in place when the
underlying rows change, so React components composed with the
[`use()`](https://react.dev/reference/react/use) hook re-render exactly
the leaves whose data moved — not "this whole list" or "this whole
card", just the `.total` that actually flipped.

The write path is equally narrow. The ORM wraps any `Driver` implementing
three methods (`exec`, `run`, `all`). Every `run` is parsed to extract
the tables the statement mutates; any `Query` / `SqlQuery` watching
those tables refetches automatically. That's the whole reactivity
primitive.

- 📚 **Docs:** https://WjcmeAFJb.github.io/sql-reactive-orm/
- 🕹️ **Live demo (sql.js + React 19 + OPFS):** https://WjcmeAFJb.github.io/sql-reactive-orm/demo/
- 💾 **Pairs especially well with:** [`sql-git`](https://github.com/WjcmeAFJb/sql-git) (distributed, action-logged SQLite).

---

## Why

If you reach for an ORM in the browser, you usually want three things:

1. **Type-safe reads** without hand-rolling `SELECT` boilerplate.
2. **Aggregate queries** (sums, counts, joins) that re-run when the
   underlying data changes.
3. **Co-existence** with your own raw SQL — because SQLite is too
   expressive to hide behind a lowest-common-denominator query builder.

sql-reactive-orm gives you all three without inventing a new query DSL.
The typed reads come from declaring entity schemas and calling
`orm.findAll(Entity, …)`. The aggregates come from `orm.sqlQuery(...)`
with a [Kysely](https://kysely.dev) builder or a raw SQL string. And raw
SQL through `orm.driver` participates in the same invalidation bus, so
"I want just one weird `WITH RECURSIVE`" doesn't break reactivity.

## Install

```bash
pnpm add 'https://github.com/WjcmeAFJb/sql-reactive-orm/releases/download/v0.2.0/sql-reactive-orm-0.2.0.tgz'
```

Peers you're likely to want:

```bash
# sql.js WASM driver (browser or Node).
pnpm add sql.js

# React 19 (lets you use `use(query)`; earlier React works via MobX
# observer wrappers — see docs for the 18.x compat snippet).
pnpm add react react-dom

# Kysely — typed query builder used for aggregates / joins.
pnpm add kysely
```

The library is shipped as TypeScript source. Any bundler or Node runner
that handles `.ts` works (Vite, esbuild, Bun, `node --experimental-strip-types`,
`tsx`).

## Quickstart

```ts
// db.ts
import { Orm } from "sql-reactive-orm";
import { SqlJsDriver } from "sql-reactive-orm/drivers/sqljs";
import { Entity, primary, text, integer, real, belongsTo, hasMany } from "sql-reactive-orm";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

// 1) Declare entities. Fields are Promises at the type level — they
//    resolve synchronously on identity-map hits and hydrate on first
//    read otherwise.
export class Account extends Entity {
  static schema = {
    name: "Account",
    table: "accounts",
    primaryKey: "id",
    fields: {
      id: primary(),
      name: text(),
      balance: real({ default: 0 }),
    },
    relations: {
      transactions: hasMany(() => Transaction, "accountId"),
    },
  };
  declare id: number;
  declare name: Promise<string>;
  declare balance: Promise<number>;
  declare transactions: Promise<Transaction[]>;
}

export class Transaction extends Entity {
  static schema = {
    name: "Transaction",
    table: "transactions",
    primaryKey: "id",
    fields: {
      id: primary(),
      accountId: integer(),
      amount: real(),
      note: text({ nullable: true }),
    },
    relations: {
      account: belongsTo(() => Account, "accountId"),
    },
  };
  declare id: number;
  declare amount: Promise<number>;
  declare note: Promise<string | null>;
  declare account: Promise<Account>;
}

// 2) Boot once per origin. Top-level await + a bare `import { orm }`
//    makes every component see an already-ready ORM.
const driver = await SqlJsDriver.open({ locateFile: () => wasmUrl });
export const orm = new Orm(driver);
await orm.register(Account, Transaction);
```

```tsx
// TransactionList.tsx
import { use } from "react";
import { orm } from "./db";
import { Transaction } from "./entities";

// `use()` suspends on first render; subsequent renders see the cached
// array. Entity fields are Promises — resolve them with `use()` too.
export function TransactionList() {
  const txs = use(
    orm.findAll(Transaction, {
      orderBy: [["id", "desc"]],
      with: { account: true },
      limit: 50,
    }),
  );
  return (
    <ul>
      {txs.map((tx) => <Row key={tx.id} tx={tx} />)}
    </ul>
  );
}

function Row({ tx }: { tx: Transaction }) {
  const amount = use(tx.amount);
  const account = use(tx.account);
  const accountName = use(account.name);
  return (
    <li>{accountName}: {amount.toFixed(2)}</li>
  );
}
```

```tsx
// NetBalance.tsx — aggregate query example.
import { use } from "react";
import { sql } from "kysely";
import { orm } from "./db";

export function NetBalance() {
  const [row] = use(
    orm.sqlQuery((db) =>
      db.selectNoFrom(
        sql<number>`COALESCE((SELECT SUM(balance) FROM accounts), 0)`.as("total"),
      ),
    ),
  );
  return <strong>${row?.total ?? 0}</strong>;
}
```

Mutate through `orm.insert / update / delete` or through a transaction:

```ts
await orm.transaction(async () => {
  await orm.insert(Transaction, { accountId: 1, amount: -12.5, note: "coffee" });
  await orm.driver.run("UPDATE accounts SET balance = balance - 12.5 WHERE id = 1");
});
// `TransactionList` and `NetBalance` both re-run on commit — positional
// row diffing keeps object identity for unchanged rows, so only `Row`s
// whose `amount` or `account` actually moved will re-render.
```

## Core concepts

### Identity map + reactive fields

Every `Entity` is cached by primary key. `orm.find(Account, 1) ===
orm.find(Account, 1)` — always the same instance. Each instance's
`_row` is a MobX `observable.ref`, so any component `use()`-ing a field
re-renders when that specific row's observable changes.

### Queries

- **`orm.findAll(cls, opts)`** — typed collection query with `where`,
  `orderBy`, `limit`, and eager `with: { relation: true, ... }`.
  Returns a `Query<T[]>` (a Promise that doubles as a reactive
  observable).
- **`orm.findFirst(cls, opts)` / `orm.find(cls, id)`** — single-row
  variants.
- **`orm.sqlQuery(sql, params?, opts?)` or `orm.sqlQuery(builder)`** —
  anything a `findAll` can't express. Accepts a raw SQL string **or** a
  Kysely builder callback; rows are diff-patched on refetch so object
  identity survives.

### Reactive driver

```ts
import { Driver, wrapReactive, detectMutatedTables } from "sql-reactive-orm";

const wrapped = wrapReactive(yourDriver, (tables) => {
  for (const t of tables) orm.invalidate(t);
});
```

The reactive wrapper intercepts `run` / `exec`, extracts table names
from the statement (INSERT, UPDATE, DELETE, REPLACE, DROP TABLE, ALTER
TABLE), and fires table-scoped invalidations. Transactions defer the
notification to COMMIT, so a 100-statement bulk update fires at most
one refetch per watched table. You can bypass the wrapper with
`orm.rawDriver` for bulk loads that should stay invisible to the UI.

### React 19 `use()` vs React 18

All examples above use React 19's `use()`. If you're on React 18.3, wrap
your components with `observer` from `mobx-react-lite` and read
`query.status` / `query.value` directly:

```tsx
import { observer } from "mobx-react-lite";
const TransactionList = observer(() => {
  const q = useMemo(() => orm.findAll(Transaction), []);
  if (q.status === "pending") return <Spinner />;
  return <ul>{q.value!.map(tx => <Row tx={tx} />)}</ul>;
});
```

### Drivers

The ORM runs against any `Driver`:

```ts
export interface Driver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly unknown[]): Promise<RunResult>;
  all<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  close?(): Promise<void>;
}
```

A `SqlJsDriver` is bundled. Wiring the ORM into
[`sql-git`](https://github.com/WjcmeAFJb/sql-git)'s `Store` is ~30
lines — see the full demo under `demo/src/sql-git/` (look for
`reads go through sql-reactive-orm, mutations through sql-git actions`
in the demo footer).

## Codegen

Optional. Run `pnpm sql-reactive-orm-codegen --config ./orm.config.ts
--out ./src/generated` to emit:

- `schema.sql` — `CREATE TABLE` DDL for every registered entity.
- `db.ts` — Kysely-compatible `DB` interface, so
  `orm.sqlQuery((db) => db.selectFrom("accounts")…)` gets full column
  inference.

The demo uses this. Entity schemas stay the single source of truth.

## Demo

[`demo/`](./demo/) is a full React 19 money-tracker (accounts,
categories, transactions, transfers, SQL console, progressive-loading
toggle that demonstrates the query-count telemetry). Run locally:

```bash
pnpm install
pnpm demo
```

Open http://localhost:5173/ — the console warnings and the number in
the status bar show how the `selectCount` drops as you flip optimization
knobs.

## Development

```bash
pnpm install
pnpm test           # Node + browser vitest suites
pnpm test:node
pnpm test:browser   # Playwright + Chromium
pnpm typecheck
```

## License

LGPL-3.0-or-later — see [`LICENSE`](./LICENSE) for the project notice,
[`COPYING.LESSER`](./COPYING.LESSER) for the full LGPL text, and
[`COPYING`](./COPYING) for the GPL text it extends.
