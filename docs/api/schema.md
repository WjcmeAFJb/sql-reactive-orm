# Schema helpers

Every `FieldDef` and `RelationDef` is a plain object; the helpers just
populate the right fields. Use them for readability; drop to literals
when you need something the helper doesn't express.

## Field helpers

```ts
import {
  integer, real, text, blob, boolean, json, primary,
} from "sql-reactive-orm";

fields: {
  id: primary(),                          // INTEGER PRIMARY KEY AUTOINCREMENT
  name: text(),                           // TEXT NOT NULL
  balance: real({ default: 0 }),          // REAL NOT NULL DEFAULT 0
  note: text({ nullable: true }),         // TEXT NULL
  email: text({ unique: true }),          // TEXT NOT NULL UNIQUE
  active: boolean({ default: true }),     // INTEGER NOT NULL DEFAULT 1, coerced to boolean
  metadata: json({ nullable: true }),     // TEXT NULL, JSON-serialized on write
  blob: blob({ nullable: true }),         // BLOB NULL
  count: integer({ default: 0 }),         // INTEGER NOT NULL DEFAULT 0
}
```

Each helper takes an optional `FieldOpts = Omit<FieldDef, "type">`:

```ts
type FieldOpts = {
  primary?: boolean;
  autoincrement?: boolean;
  nullable?: boolean;
  unique?: boolean;
  default?: string | number | null;
  json?: boolean;
  boolean?: boolean;
};
```

## Non-INTEGER primary keys

`primary()` is opinionated (INTEGER AUTOINCREMENT). For string IDs,
write the literal:

```ts
fields: {
  id: { type: "TEXT", primary: true },
  name: text(),
}
```

## Relations

```ts
import { belongsTo, hasMany, hasOne } from "sql-reactive-orm";

relations: {
  author:  belongsTo(() => User, "authorId"),
  posts:   hasMany(() => Post, "authorId"),
  profile: hasOne(() => Profile, "userId"),
}
```

The target is a thunk so you can freely forward-reference classes:

```ts
export class Comment extends Entity {
  static schema = {
    // ...
    relations: {
      post: belongsTo(() => Post, "postId"), // forward-referenced
    },
  };
}
```

## DDL generator

```ts
import { generateDDL } from "sql-reactive-orm";

const sql = generateDDL(Account.schema);
// "CREATE TABLE IF NOT EXISTS \"accounts\" (\"id\" INTEGER PRIMARY KEY AUTOINCREMENT, ...)"
```

`orm.register(cls)` calls this internally to ensure the table exists.
If you run DDL separately (migrations, codegen), the `IF NOT EXISTS`
makes it idempotent.

## Types

```ts
type SqliteType = "INTEGER" | "REAL" | "TEXT" | "BLOB";

interface FieldDef {
  type: SqliteType;
  primary?: boolean;
  autoincrement?: boolean;
  nullable?: boolean;
  unique?: boolean;
  default?: string | number | null;
  json?: boolean;
  boolean?: boolean;
}

type RelationKind = "hasMany" | "belongsTo" | "hasOne";

interface RelationDef {
  kind: RelationKind;
  target: () => EntityClass<Entity>;
  foreignKey: string;
  localKey: string;
}

interface EntitySchema {
  name: string;
  table: string;
  primaryKey: string;
  fields: Record<string, FieldDef>;
  relations: Record<string, RelationDef>;
}
```

## See also

- [Entities & relations](/concepts/entities)
- [Codegen](/guide/codegen)
