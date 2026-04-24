# Entities & relations

An entity is a TypeScript class that extends `Entity` and carries a
static `schema` describing its table.

## Minimal shape

```ts
import {
  Entity, primary, text, integer, real,
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
      balance: real({ default: 0 }),
    },
    relations: {},
  };
  declare id: number;
  declare name: Promise<string>;
  declare balance: Promise<number>;
}
```

### `name`

The human-readable entity name. Used in error messages and as the
identity-map key.

### `table`

The SQL table name. The name the ORM emits in generated SQL.

### `primaryKey`

The single-column primary key. (Composite PKs aren't supported yet.)

### `fields`

Keyed by column name, valued by a `FieldDef`:

```ts
type SqliteType = "INTEGER" | "REAL" | "TEXT" | "BLOB";
interface FieldDef {
  type: SqliteType;
  primary?: boolean;
  autoincrement?: boolean;
  nullable?: boolean;
  unique?: boolean;
  default?: string | number | null;
  json?: boolean;    // serialized as TEXT, parsed on read
  boolean?: boolean; // stored as INTEGER 0/1, coerced on read
}
```

Helpers construct common shapes:

- `primary()` — `{ type: "INTEGER", primary: true, autoincrement: true }`
- `text(opts?)` / `integer(opts?)` / `real(opts?)` / `blob(opts?)`
- `boolean()` — stored as INTEGER, read as boolean
- `json()` — stored as TEXT, parsed on read

For non-INTEGER primary keys (text IDs, UUIDs), skip the helper and
use a literal `FieldDef`:

```ts
fields: {
  id: { type: "TEXT", primary: true },
  // ...
}
```

### `relations`

```ts
relations: {
  transactions: hasMany(() => Transaction, "accountId"),
  owner:        belongsTo(() => User, "ownerId"),
  profile:      hasOne(() => Profile, "accountId"),
}
```

- `hasMany(target, foreignKey)` — `this.<relation>: Promise<T[]>`.
  Loaded via `SELECT * FROM <T.table> WHERE <foreignKey> = <this.pk>`.
- `belongsTo(target, foreignKey)` — `this.<relation>: Promise<T>`.
  `this.<foreignKey>` must be present; looked up via `find(target, fk)`.
- `hasOne(target, foreignKey)` — `this.<relation>: Promise<T | null>`.

The target is a thunk (`() => Transaction`) so you can reference
classes that haven't been defined yet (circular imports).

## Class members

```ts
declare id: number;
declare name: Promise<string>;
declare balance: Promise<number>;
declare transactions: Promise<Transaction[]>;
```

`declare` tells TypeScript "there's a property here at runtime" without
emitting a slot. The ORM's `installAccessors` (called from
`orm.register`) defines real getters on the prototype that return the
MobX-observed promises.

## Custom methods

Entities are regular classes — add any methods you like:

```ts
export class Account extends Entity {
  static schema = {...};
  declare id: number;
  declare balance: Promise<number>;

  async transferTo(other: Account, amount: number) {
    await this._orm.transaction(async () => {
      await this._orm.insert(Transaction, {
        accountId: this.id,
        amount: -amount,
        date: new Date().toISOString(),
      });
      await this._orm.insert(Transaction, {
        accountId: other.id,
        amount,
        date: new Date().toISOString(),
      });
    });
  }
}

// Usage
const alice = await orm.find(Account, 1);
const bob = await orm.find(Account, 2);
await alice.transferTo(bob, 100);
```

Two per-instance references exist:

- `this._orm` — the Orm instance that loaded this entity.
- `this._row` — the raw row snapshot (MobX-observable ref). Accessible
  from within the class; not part of the public API.

## Registering entities

```ts
const orm = new Orm(driver);
await orm.register(Account, Transaction, Category);
```

Registration:

1. Installs reactive getters on each prototype via `installAccessors`.
2. Creates an empty identity map slot for the entity.
3. Runs the entity's DDL (`CREATE TABLE IF NOT EXISTS ...`) through the
   driver. If you emit DDL separately (codegen, migrations), the
   `IF NOT EXISTS` means this is a no-op.

## See also

- [Identity map](/concepts/identity-map)
- [API — Schema helpers](/api/schema)
