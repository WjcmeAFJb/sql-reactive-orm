import type { Entity } from "./entity.js";

export type SqliteType = "INTEGER" | "REAL" | "TEXT" | "BLOB";

export interface FieldDef {
  type: SqliteType;
  primary?: boolean;
  autoincrement?: boolean;
  nullable?: boolean;
  unique?: boolean;
  default?: string | number | null;
  /** Stored as TEXT, parsed on read / stringified on write. */
  json?: boolean;
  /** Stored as INTEGER 0/1, coerced to boolean on read. */
  boolean?: boolean;
}

export type RelationKind = "hasMany" | "belongsTo" | "hasOne";

export interface RelationDef {
  kind: RelationKind;
  target: () => EntityClass<Entity>;
  foreignKey: string;
  localKey: string;
}

export interface EntitySchema {
  name: string;
  table: string;
  primaryKey: string;
  fields: Record<string, FieldDef>;
  relations: Record<string, RelationDef>;
}

export interface EntityClass<T extends Entity = Entity> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (orm: import("./orm.js").Orm<any>, id: unknown): T;
  schema: EntitySchema;
}

// ---- field helpers ----

type FieldOpts = Omit<FieldDef, "type">;

export const integer = (opts: FieldOpts = {}): FieldDef => ({
  ...opts,
  type: "INTEGER",
});
export const real = (opts: FieldOpts = {}): FieldDef => ({
  ...opts,
  type: "REAL",
});
export const text = (opts: FieldOpts = {}): FieldDef => ({
  ...opts,
  type: "TEXT",
});
export const blob = (opts: FieldOpts = {}): FieldDef => ({
  ...opts,
  type: "BLOB",
});
export const boolean = (opts: FieldOpts = {}): FieldDef => ({
  ...opts,
  type: "INTEGER",
  boolean: true,
});
export const json = (opts: FieldOpts = {}): FieldDef => ({
  ...opts,
  type: "TEXT",
  json: true,
});

export const primary = (opts: Omit<FieldDef, "type" | "primary"> = {}): FieldDef => ({
  type: "INTEGER",
  primary: true,
  autoincrement: true,
  ...opts,
});

// ---- DDL ----

export function generateDDL(schema: EntitySchema): string {
  const cols: string[] = [];
  for (const [name, def] of Object.entries(schema.fields)) {
    let col = `"${name}" ${def.type}`;
    if (def.primary) col += " PRIMARY KEY";
    if (def.autoincrement && def.type === "INTEGER" && def.primary) col += " AUTOINCREMENT";
    if (def.unique && !def.primary) col += " UNIQUE";
    if (!def.nullable && !def.primary) col += " NOT NULL";
    if (def.default !== undefined) col += ` DEFAULT ${JSON.stringify(def.default)}`;
    cols.push(col);
  }
  return `CREATE TABLE IF NOT EXISTS "${schema.table}" (${cols.join(", ")})`;
}
