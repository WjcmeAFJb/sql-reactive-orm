import { Entity, installAccessors } from "./entity.js";
import { Query, type QueryOptions } from "./query.js";
import type { Driver } from "./driver.js";
import { generateDDL } from "./schema.js";
import type { EntityClass, FieldDef, RelationDef } from "./schema.js";

function encode(def: FieldDef, value: unknown): unknown {
  if (value == null) return null;
  if (def.json) return JSON.stringify(value);
  if (def.boolean) return value ? 1 : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

/**
 * The ORM. Owns:
 *   - a driver (SQL execution)
 *   - the entity registry (name → class)
 *   - identity maps (one Map per entity; ensures `find(User, 1) === find(User, 1)`)
 *   - a table mutation bus (Queries subscribe; relations listen for invalidation)
 */
export class Orm {
  readonly driver: Driver;
  private readonly _entities = new Map<string, EntityClass<Entity>>();
  private readonly _identity = new Map<string, Map<unknown, Entity>>();
  private readonly _subscribers = new Map<string, Set<() => void>>();

  constructor(driver: Driver) {
    this.driver = driver;
  }

  /**
   * Register entity classes. Installs reactive field/relation getters on
   * each prototype, creates an empty identity map, and creates the table
   * via `CREATE TABLE IF NOT EXISTS`.
   */
  async register(...classes: readonly EntityClass<Entity>[]): Promise<void> {
    for (const cls of classes) {
      const name = cls.schema.name;
      if (this._entities.has(name)) continue;
      this._entities.set(name, cls);
      this._identity.set(name, new Map());
      installAccessors(cls);
    }
    for (const cls of classes) {
      await this.driver.exec(generateDDL(cls.schema));
    }
  }

  // ---- identity map ----

  _getOrCreate<T extends Entity>(
    cls: EntityClass<T>,
    id: unknown,
  ): T {
    const map = this._identity.get(cls.schema.name);
    if (!map)
      throw new Error(
        `Entity "${cls.schema.name}" not registered — call orm.register(${cls.schema.name})`,
      );
    let inst = map.get(id) as T | undefined;
    if (!inst) {
      inst = new cls(this, id);
      map.set(id, inst);
    }
    return inst;
  }

  /** Return the existing instance for `id` or undefined (no DB hit). */
  peek<T extends Entity>(cls: EntityClass<T>, id: unknown): T | undefined {
    return this._identity.get(cls.schema.name)?.get(id) as T | undefined;
  }

  // ---- subscription bus ----

  _subscribe(
    tables: ReadonlySet<string>,
    callback: () => void,
  ): () => void {
    for (const t of tables) {
      let set = this._subscribers.get(t);
      if (!set) {
        set = new Set();
        this._subscribers.set(t, set);
      }
      set.add(callback);
    }
    return () => {
      for (const t of tables) this._subscribers.get(t)?.delete(callback);
    };
  }

  /**
   * Signal that `table` changed. Notifies all subscribed queries and
   * invalidates relations on cached entities whose target is `table`.
   */
  _notifyTable(table: string): void {
    const subs = this._subscribers.get(table);
    if (subs) for (const cb of [...subs]) cb();

    for (const [entityName, cls] of this._entities) {
      let targets = false;
      for (const rel of Object.values(cls.schema.relations)) {
        if (rel.target().schema.table === table) {
          targets = true;
          break;
        }
      }
      if (!targets) continue;
      const map = this._identity.get(entityName);
      if (!map) continue;
      for (const inst of map.values()) inst._invalidateRelations(table);
    }
  }

  // ---- row loaders (used by Entity) ----

  async _loadRow(entity: Entity): Promise<Record<string, unknown>> {
    const schema = entity._schema();
    const rows = await this.driver.all<Record<string, unknown>>(
      `SELECT * FROM "${schema.table}" WHERE "${schema.primaryKey}" = ? LIMIT 1`,
      [entity.id],
    );
    const row = rows[0];
    if (!row) {
      throw new Error(`${schema.name} with id=${String(entity.id)} not found`);
    }
    return row;
  }

  async _loadRelation(
    entity: Entity,
    rel: RelationDef,
  ): Promise<unknown> {
    const TargetCls = rel.target();
    const targetSchema = TargetCls.schema;
    const parentSchema = entity._schema();

    if (rel.kind === "belongsTo") {
      const fk = await entity._getField(rel.foreignKey);
      if (fk == null) return null;
      const inst = this._getOrCreate(TargetCls, fk);
      return inst;
    }

    const localValue =
      rel.localKey === parentSchema.primaryKey
        ? entity.id
        : await entity._getField(rel.localKey);
    if (localValue == null) return rel.kind === "hasOne" ? null : [];

    const rows = await this.driver.all<Record<string, unknown>>(
      `SELECT * FROM "${targetSchema.table}" WHERE "${rel.foreignKey}" = ?`,
      [localValue],
    );
    const instances = rows.map((row) => {
      const inst = this._getOrCreate(TargetCls, row[targetSchema.primaryKey]);
      inst._applyRow(row);
      return inst;
    });
    return rel.kind === "hasOne" ? instances[0] ?? null : instances;
  }

  // ---- mutations ----

  async insert<T extends Entity>(
    cls: EntityClass<T>,
    data: Record<string, unknown>,
  ): Promise<T> {
    const schema = cls.schema;
    const cols = Object.keys(data).filter((k) => k in schema.fields);
    const values = cols.map((c) => encode(schema.fields[c], data[c]));
    const sql = cols.length
      ? `INSERT INTO "${schema.table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
      : `INSERT INTO "${schema.table}" DEFAULT VALUES`;
    const result = await this.driver.run(sql, values);
    const id =
      data[schema.primaryKey] ??
      (typeof result.lastInsertRowid === "bigint"
        ? Number(result.lastInsertRowid)
        : result.lastInsertRowid);
    const inst = this._getOrCreate(cls, id);
    const rows = await this.driver.all<Record<string, unknown>>(
      `SELECT * FROM "${schema.table}" WHERE "${schema.primaryKey}" = ?`,
      [id],
    );
    if (rows[0]) inst._applyRow(rows[0]);
    this._notifyTable(schema.table);
    return inst;
  }

  async update<T extends Entity>(
    entity: T,
    patch: Record<string, unknown>,
  ): Promise<T> {
    const schema = entity._schema();
    const cols = Object.keys(patch).filter(
      (k) => k in schema.fields && k !== schema.primaryKey,
    );
    if (cols.length === 0) return entity;
    const values = cols.map((c) => encode(schema.fields[c], patch[c]));
    const set = cols.map((c) => `"${c}" = ?`).join(", ");
    await this.driver.run(
      `UPDATE "${schema.table}" SET ${set} WHERE "${schema.primaryKey}" = ?`,
      [...values, entity.id],
    );
    const rows = await this.driver.all<Record<string, unknown>>(
      `SELECT * FROM "${schema.table}" WHERE "${schema.primaryKey}" = ?`,
      [entity.id],
    );
    if (rows[0]) entity._applyRow(rows[0]);
    this._notifyTable(schema.table);
    return entity;
  }

  async delete(entity: Entity): Promise<void> {
    const schema = entity._schema();
    await this.driver.run(
      `DELETE FROM "${schema.table}" WHERE "${schema.primaryKey}" = ?`,
      [entity.id],
    );
    this._identity.get(schema.name)?.delete(entity.id);
    this._notifyTable(schema.table);
  }

  // ---- queries ----

  findAll<T extends Entity>(
    cls: EntityClass<T>,
    opts: QueryOptions = {},
  ): Query<T[]> {
    return new Query<T[]>(
      this,
      cls as unknown as EntityClass<Entity>,
      opts,
      "findAll",
    );
  }

  findFirst<T extends Entity>(
    cls: EntityClass<T>,
    opts: QueryOptions = {},
  ): Query<T | null> {
    return new Query<T | null>(
      this,
      cls as unknown as EntityClass<Entity>,
      opts,
      "findFirst",
    );
  }

  find<T extends Entity>(
    cls: EntityClass<T>,
    id: unknown,
    opts: Omit<QueryOptions, "where"> = {},
  ): Query<T | null> {
    return this.findFirst(cls, {
      ...opts,
      where: { [cls.schema.primaryKey]: id as never },
    });
  }

  async close(): Promise<void> {
    await this.driver.close?.();
  }
}
