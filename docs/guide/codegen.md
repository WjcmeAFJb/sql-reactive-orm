# Codegen

Optional. sql-reactive-orm ships a small CLI that reads your registered
entity classes and emits:

- `schema.sql` — the `CREATE TABLE` DDL for every entity.
- `db.ts` — a [Kysely](https://kysely.dev) `DB` interface, giving you
  full column inference inside `orm.sqlQuery(db => db.selectFrom(...))`.

Everything it produces is derivable from the entities — if you prefer
to hand-author the DDL and Kysely types, skip this entirely.

## Config

```ts
// orm.config.ts
import type { OrmConfig } from "sql-reactive-orm";
import { Account, Category, Transaction } from "./src/entities";

export default {
  entities: [Account, Category, Transaction],
} satisfies OrmConfig;
```

## Run

```bash
pnpm sql-reactive-orm-codegen --config ./orm.config.ts --out ./src/generated
```

Outputs:

- `./src/generated/schema.sql`
- `./src/generated/db.ts`

## Wire up Kysely

```ts
// orm.ts
import { Orm } from "sql-reactive-orm";
import type { DB } from "./generated/db";
import { Account, Category, Transaction } from "./entities";

const orm = new Orm<DB>(driver);
await orm.register(Account, Category, Transaction);

// Now orm.sqlQuery's builder is typed against DB.
orm.sqlQuery((db) =>
  db
    .selectFrom("transactions")
    .innerJoin("accounts", "accounts.id", "transactions.accountId")
    .select(["accounts.name", "transactions.amount"])
    .where("transactions.amount", "<", 0)
    .orderBy("transactions.amount", "asc"),
);
```

## Running on every build

Add to your `package.json`:

```json
{
  "scripts": {
    "codegen": "sql-reactive-orm-codegen --config ./orm.config.ts --out ./src/generated",
    "prebuild": "pnpm codegen",
    "dev": "pnpm codegen && vite"
  }
}
```

Or call it from a pre-commit hook so the generated files stay in sync
with the entity schemas.

## Limitations

- Relations (`belongsTo`, `hasMany`, `hasOne`) don't emit foreign-key
  constraints. Add those by hand to the generated SQL or in a follow-up
  migration.
- Indexes aren't generated. The codegen is intentionally lean — you
  write `CREATE INDEX` in your own DDL.
- Field defaults beyond literals aren't serialised. Codegen falls back
  to `NULL` or the type's zero for compound defaults.

## Next

- [API — Orm](/api/orm)
- [API — Schema helpers](/api/schema)
