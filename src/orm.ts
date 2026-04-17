import { Entity, installAccessors } from "./entity.js";
import { Query, type QueryOptions } from "./query.js";
import type { Driver } from "./driver.js";
import { wrapReactive } from "./reactive-driver.js";
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
  /**
   * Reactive driver: any `run` / `exec` through this driver that looks
   * like a mutation (INSERT / UPDATE / DELETE / REPLACE / DROP TABLE /
   * ALTER TABLE) automatically invalidates queries and relations that
   * touch the affected tables. Use this for custom Entity methods that
   * emit raw SQL — the ORM stays reactive without you having to tell it
   * what you did.
   */
  readonly driver: Driver;
  /**
   * The un-wrapped driver, kept as an escape hatch. Writes through this
   * do NOT fire any invalidation. Use for bulk loads, migrations, or any
   * other case where you explicitly want the ORM to remain oblivious.
   */
  readonly rawDriver: Driver;

  private readonly _entities = new Map<string, EntityClass<Entity>>();
  private readonly _identity = new Map<string, Map<unknown, Entity>>();
  private readonly _subscribers = new Map<string, Set<() => void>>();

  constructor(driver: Driver) {
    this.rawDriver = driver;
    this.driver = wrapReactive(driver, (tables) => {
      for (const t of tables) this._notifyTable(t);
    });
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
   * Manually signal that `table` changed — use this when you've bypassed
   * `orm.driver` entirely (different sql.js connection, a query builder
   * with its own handle, etc.) so the ORM still knows to refetch.
   */
  invalidate(table: string): void {
    this._notifyTable(table);
  }

  /**
   * Signal that `table` changed. Kicks three things in order:
   *   1. A batched row-refresh for every cached entity instance in
   *      `table`. This is what makes direct-entity observers (not going
   *      through a Query) reactive to raw SQL — `entity._row` is an
   *      observable ref, so `_applyRow` on the latest DB state triggers
   *      any `observer`-wrapped component reading a field on it. Fires
   *      a single `SELECT … WHERE id IN (...)` regardless of cache size.
   *   2. The Query subscription bus: any findAll / findFirst watching
   *      this table re-executes.
   *   3. Relation invalidation: drop cached relation promises on
   *      entities whose schema has a relation targeting `table`, so the
   *      next relation read re-queries.
   */
  _notifyTable(table: string): void {
    void this._refreshCachedRowsFor(table);

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

  private async _refreshCachedRowsFor(table: string): Promise<void> {
    for (const [entityName, cls] of this._entities) {
      if (cls.schema.table !== table) continue;
      const map = this._identity.get(entityName);
      if (!map || map.size === 0) continue;
      const schema = cls.schema;
      const ids = [...map.keys()];
      const placeholders = ids.map(() => "?").join(",");
      let rows: Record<string, unknown>[];
      try {
        rows = await this.driver.all<Record<string, unknown>>(
          `SELECT * FROM "${schema.table}" WHERE "${schema.primaryKey}" IN (${placeholders})`,
          ids,
        );
      } catch {
        // Don't let a background refresh failure cascade — a caller
        // may be in the middle of dropping the table, for instance.
        return;
      }
      const byId = new Map<unknown, Record<string, unknown>>();
      for (const r of rows) byId.set(r[schema.primaryKey], r);
      // Only touch entities that were in the snapshot — a concurrent
      // `_getOrCreate` (e.g. from orm.insert returning immediately after
      // the wrapper fired notify) may have added new ids to the map
      // *after* we captured `ids`; those rows weren't part of this
      // refresh's SELECT and must not be considered missing.
      for (const id of ids) {
        const inst = map.get(id);
        if (!inst) continue;
        const row = byId.get(id);
        if (row) {
          inst._applyRow(row);
        } else {
          map.delete(id);
        }
      }
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
    // No explicit notifyTable: the reactive driver wrapper already fired
    // when `driver.run(INSERT ...)` returned above.
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
    // Reactive driver wrapper already notified on the UPDATE.
    return entity;
  }

  async delete(entity: Entity): Promise<void> {
    const schema = entity._schema();
    await this.driver.run(
      `DELETE FROM "${schema.table}" WHERE "${schema.primaryKey}" = ?`,
      [entity.id],
    );
    this._identity.get(schema.name)?.delete(entity.id);
    // Reactive driver wrapper already notified on the DELETE.
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
