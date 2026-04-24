---
layout: home
hero:
  name: sql-reactive-orm
  text: Reactive ORM for SQLite, built on MobX
  tagline: Entity fields are Promises. React `use()`-native. Aggregate queries that re-run — and re-render only the leaves whose data moved.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Live demo
      link: /sql-reactive-orm/demo/
    - theme: alt
      text: GitHub
      link: https://github.com/WjcmeAFJb/sql-reactive-orm

features:
  - title: Promises as fields
    details: "user.name is a Promise<string>. user.posts is a Promise<Post[]>. Identity-map hits resolve synchronously; misses hydrate in the background."
  - title: React use() native
    details: "Drop a query straight into use(orm.findAll(...)) and get Suspense-friendly loading, stable row identity, and per-field reactivity."
  - title: Aggregates with Kysely
    details: "orm.sqlQuery(db => db.selectFrom('transactions')…) — typed, auto-invalidated on every write to the involved tables."
  - title: Any SQL driver
    details: "The ORM talks through a 3-method Driver interface. A SqlJsDriver ships in the box; plug your own into anything that can run SQL."
  - title: Reactive writes, too
    details: "The reactive driver parses each run / exec, extracts mutated tables, and fires table-scoped invalidations automatically. Batched inside transactions."
  - title: Pairs with sql-git
    details: "Hand the ORM a driver backed by sql-git's Store.db and you get replicated, reactive SQLite — in the browser."
---

## At a glance

```tsx
// orm.ts
import { Orm } from "sql-reactive-orm";
import { SqlJsDriver } from "sql-reactive-orm/drivers/sqljs";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { Account, Transaction } from "./entities";

const driver = await SqlJsDriver.open({ locateFile: () => wasmUrl });
export const orm = new Orm(driver);
await orm.register(Account, Transaction);

// TransactionList.tsx
import { use } from "react";
import { orm } from "./orm";
import { Transaction } from "./entities";

export function TransactionList() {
  const txs = use(
    orm.findAll(Transaction, {
      orderBy: [["id", "desc"]],
      with: { account: true },
      limit: 50,
    }),
  );
  return <ul>{txs.map(tx => <li key={tx.id}>{use(tx.amount)}</li>)}</ul>;
}
```

- [Getting started](/guide/getting-started)
- [Reactivity model](/concepts/reactivity)
- [Integration with sql-git](/guide/sql-git)
