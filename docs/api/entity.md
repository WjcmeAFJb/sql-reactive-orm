# Entity

Base class for reactive entities. Declare a static `schema`; the ORM
installs reactive getters for every field and relation.

## Minimum

```ts
import { Entity, primary, text, type EntitySchema } from "sql-reactive-orm";

export class Account extends Entity {
  static schema: EntitySchema = {
    name: "Account",
    table: "accounts",
    primaryKey: "id",
    fields: {
      id: primary(),
      name: text(),
    },
    relations: {},
  };
  declare id: number;
  declare name: Promise<string>;
}
```

`declare` instructs TypeScript that these properties exist at runtime
but doesn't emit field initialisers — the ORM installs them on the
prototype.

## The `_orm` handle

Every entity instance has `this._orm: Orm<any>` — the ORM that loaded
it. Useful inside custom methods:

```ts
export class Account extends Entity {
  // ...
  async remove() {
    await this._orm.transaction(async () => {
      await this._orm.driver.run(
        'DELETE FROM "transactions" WHERE "accountId" = ?',
        [this.id],
      );
      await this._orm.driver.run('DELETE FROM "accounts" WHERE "id" = ?', [
        this.id,
      ]);
    });
  }
}
```

## The `_row` observable

An instance's raw column values live at `this._row` — a MobX
`observable.ref`. You don't usually read it directly; the reactive
getters installed by `orm.register` hide it.

When a mutation invalidates the entity's table, the ORM re-fetches the
row and swaps `_row`. Deep equality keeps object identity where
possible so consumers that only read the unchanged fields don't
re-render.

## Field accessors

`orm.register(cls)` walks the static schema and defines getters on the
class prototype:

```ts
Object.defineProperty(cls.prototype, "name", {
  get(this: Entity) {
    return this._field("name"); // returns Promise<string>
  },
});
```

The returned promise is a `TrackedPromise` — `.status`, `.value`,
`.reason` are observables, so `use(entity.name)` works in React 19 and
`observer(() => entity.name.value)` works in React 18.

## Relation accessors

Similarly:

```ts
Object.defineProperty(cls.prototype, "transactions", {
  get(this: Entity) {
    return this._relation("transactions");
  },
});
```

Relations are lazily loaded on first read. Eager-load during a query
via `with: { transactions: true }` to pre-populate.

## Manual hydration

If you need to force-refresh an entity's row from the db (e.g., after
an out-of-band mutation):

```ts
await entity._orm._loadRow(entity);
```

or, preferred:

```ts
orm.invalidate(cls.schema.table);
```

## Custom methods

Entities are plain classes. Add any methods. Refer to `this._orm` /
`this.id` / `this.<field>` freely:

```ts
async transferTo(other: Account, amount: number) {
  await this._orm.transaction(async () => {
    await this._orm.insert(Transaction, { accountId: this.id, amount: -amount, date: nowIso() });
    await this._orm.insert(Transaction, { accountId: other.id, amount, date: nowIso() });
  });
}
```

## See also

- [Entities & relations](/concepts/entities)
- [Schema helpers](/api/schema)
