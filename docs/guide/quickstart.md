# Quickstart

A minimal React + Vite app with one entity, one mutation, and
re-rendering only the rows whose data changed.

## Install

```bash
pnpm create vite@latest tracker -- --template react-ts
cd tracker
pnpm add 'https://github.com/WjcmeAFJb/sql-reactive-orm/releases/download/v0.1.0/sql-reactive-orm-0.1.0.tgz' \
        sql.js kysely
```

## Define entities

```ts
// src/entities.ts
import {
  Entity, primary, text, integer, real, belongsTo, hasMany,
  type EntitySchema,
} from "sql-reactive-orm";

export class Account extends Entity {
  static schema: EntitySchema = {
    name: "Account",
    table: "accounts",
    primaryKey: "id",
    fields: {
      id: primary(),
      name: text(),
      initialBalance: real({ default: 0 }),
    },
    relations: {
      transactions: hasMany(() => Transaction, "accountId"),
    },
  };
  declare id: number;
  declare name: Promise<string>;
  declare initialBalance: Promise<number>;
  declare transactions: Promise<Transaction[]>;
}

export class Transaction extends Entity {
  static schema: EntitySchema = {
    name: "Transaction",
    table: "transactions",
    primaryKey: "id",
    fields: {
      id: primary(),
      accountId: integer(),
      amount: real(),
      note: text({ nullable: true }),
      date: text(),
    },
    relations: {
      account: belongsTo(() => Account, "accountId"),
    },
  };
  declare id: number;
  declare amount: Promise<number>;
  declare note: Promise<string | null>;
  declare date: Promise<string>;
  declare account: Promise<Account>;
}
```

## Initialise the ORM

Top-level `await` keeps every downstream `import { orm }` synchronous:

```ts
// src/orm.ts
import { Orm } from "sql-reactive-orm";
import { SqlJsDriver } from "sql-reactive-orm/drivers/sqljs";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { Account, Transaction } from "./entities";

async function init() {
  const driver = await SqlJsDriver.open({ locateFile: () => wasmUrl });
  const orm = new Orm(driver);

  // DDL. Either run by hand or codegen to schema.sql and run in bulk.
  await driver.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      initialBalance REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      accountId INTEGER NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      date TEXT NOT NULL
    );
  `);

  await orm.register(Account, Transaction);
  return orm;
}

export const orm = await init();
```

## Components

```tsx
// src/App.tsx
import { use } from "react";
import { orm } from "./orm";
import { Account, Transaction } from "./entities";

export function App() {
  return (
    <Suspense fallback={<p>loading…</p>}>
      <Accounts />
      <Transactions />
    </Suspense>
  );
}

function Accounts() {
  const accounts = use(orm.findAll(Account, { orderBy: [["name", "asc"]] }));
  return (
    <ul>
      {accounts.map((a) => <AccountRow key={a.id} account={a} />)}
    </ul>
  );
}

function AccountRow({ account }: { account: Account }) {
  const name = use(account.name);
  const balance = use(account.initialBalance);
  return <li>{name}: {balance.toFixed(2)}</li>;
}

function Transactions() {
  const txs = use(
    orm.sqlQuery<{ id: number; total: number }>(
      `SELECT accountId AS id, SUM(amount) AS total FROM transactions GROUP BY accountId`,
    ),
  );
  return <pre>{JSON.stringify(txs, null, 2)}</pre>;
}
```

## Mutate

Mutations go through either the entity methods (`orm.insert`, `orm.update`,
`orm.delete`) or raw `orm.driver.run(...)`. Either path participates in
the reactive invalidation bus:

```tsx
async function addCoffee() {
  await orm.insert(Transaction, {
    accountId: 1,
    amount: -4.5,
    note: "latte",
    date: new Date().toISOString(),
  });
  // Every `use()` above this root that watches `transactions`
  // refetches. Row identity survives for unchanged rows.
}
```

## Run

```bash
pnpm dev
```

Open the app, flip between renders — only the `AccountRow` whose
`initialBalance` actually moved re-renders. Check the console: the
`orm.driver.run` you triggered is the only statement logged.

## Next

- [Reactivity model](/concepts/reactivity)
- [Aggregate queries](/concepts/aggregates)
- [Integration with sql-git](/guide/sql-git)
