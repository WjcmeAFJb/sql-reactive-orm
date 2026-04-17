import { Entity, installAccessors } from "./entity.js";
import { Query, eagerLoad, queryKey, type QueryKind, type QueryOptions } from "./query.js";
import type { Driver } from "./driver.js";
import { wrapReactive } from "./reactive-driver.js";
import { generateDDL } from "./schema.js";
import type { EntityClass, FieldDef, RelationDef } from "./schema.js";
import { SqlQuery, type SqlQueryOptions } from "./sql-query.js";
import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type Compilable,
} from "kysely";

function sqlKey(sql: string, params: readonly unknown[], options: SqlQueryOptions<never>): string {
  const keyBy = options.keyBy ? options.keyBy.toString() : "";
  const watch = options.watch ? [...options.watch].sort().join(",") : "";
  return `sql:${sql}:${JSON.stringify(params)}:${watch}:${keyBy}`;
}

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
export class Orm<DB = unknown> {
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
  private readonly _pendingRefreshes = new Set<Promise<unknown>>();
  /**
   * Mutex-as-promise-chain for `transaction()`. Each caller awaits the
   * previous caller's completion before issuing its BEGIN. Guarantees
   * SQLite's single-transaction-per-connection invariant holds under
   * concurrent callers.
   */
  private _txChain: Promise<void> = Promise.resolve();
  /**
   * Cache of live `Query` objects keyed by (kind, entity, stable-opts).
   * The point is that `orm.findAll(Transaction, { … })` typed inline
   * inside a component's render returns the *same* Query object every
   * time — so React 19's `use(query)` sees a stable thenable, and the
   * component's re-renders don't re-issue the SELECT.
   */
  private readonly _queryCache = new Map<string, Query<unknown>>();
  private readonly _sqlCache = new Map<string, SqlQuery<unknown>>();
  /**
   * Kysely instance configured for SQLite + a DummyDriver — we use it
   * exclusively to compile typed query builders to `{ sql, parameters }`.
   * Execution still goes through our own reactive driver.
   */
  readonly kysely: Kysely<DB>;

  constructor(driver: Driver) {
    this.rawDriver = driver;
    this.driver = wrapReactive(driver, (tables) => {
      for (const t of tables) this._notifyTable(t);
    });
    this.kysely = new Kysely<DB>({
      dialect: {
        createAdapter: () => new SqliteAdapter(),
        createDriver: () => new DummyDriver(),
        createIntrospector: (db) => new SqliteIntrospector(db),
        createQueryCompiler: () => new SqliteQueryCompiler(),
      },
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

  _getOrCreate<T extends Entity>(cls: EntityClass<T>, id: unknown): T {
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

  /**
   * Drop cached row data + relation results from every identity-mapped
   * entity. Object identity is preserved (a component holding an
   * entity will keep seeing the same instance), but the next field /
   * relation access goes back to the driver. Handy for "reload from
   * disk" buttons and for the demo's loading-strategy toggle.
   */
  clearCaches(): void {
    for (const map of this._identity.values()) {
      for (const inst of map.values()) inst._invalidate();
    }
  }

  // ---- subscription bus ----

  _subscribe(tables: ReadonlySet<string>, callback: () => void): () => void {
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
   * Signal that `table` changed. Schedules three things:
   *
   *   1. A batched row refresh for every cached entity instance in
   *      `table` — one `SELECT … WHERE id IN (...)` regardless of cache
   *      size. Entity rows are observable refs, so `_applyRow` on the
   *      latest DB state propagates to every `observer` reading a field.
   *
   *   2. A batched relation refresh for every cached relation whose
   *      target is `table`. We re-run the relation's IN-clause SELECT
   *      through `eagerLoad`, which calls `_applyRelation` with the new
   *      list. Crucially we do **not** clear the cached relation
   *      promise first — observers keep rendering the previous list
   *      until the fresh one arrives, so the UI never suspends into a
   *      fallback on mutation (stale-while-revalidate).
   *
   *   3. The Query subscription bus: any findAll / findFirst watching
   *      this table re-executes.
   *
   * Steps 1 and 2 are async. Callers that need to observe the post-
   * mutation state synchronously (tests, any write-then-immediately-
   * read sequence) can `await orm.settle()` to wait for the refreshes
   * currently in flight.
   */
  _notifyTable(table: string): void {
    this._trackRefresh(this._refreshCachedRowsFor(table));
    this._trackRefresh(this._refreshCachedRelationsFor(table));

    const subs = this._subscribers.get(table);
    if (subs) for (const cb of [...subs]) cb();
  }

  private _trackRefresh(p: Promise<unknown>): void {
    this._pendingRefreshes.add(p);
    p.finally(() => this._pendingRefreshes.delete(p));
  }

  /**
   * Wait for every in-flight background refresh (row + relation) to
   * land. Handy in tests after a mutation, before asserting on a
   * relation that the ORM is about to re-populate.
   */
  async settle(): Promise<void> {
    while (this._pendingRefreshes.size > 0) {
      await Promise.all([...this._pendingRefreshes]);
    }
  }

  private async _refreshCachedRelationsFor(table: string): Promise<void> {
    for (const [entityName, cls] of this._entities) {
      const map = this._identity.get(entityName);
      if (!map || map.size === 0) continue;
      for (const [relName, rel] of Object.entries(cls.schema.relations)) {
        if (rel.target().schema.table !== table) continue;
        const parents: Entity[] = [];
        for (const inst of map.values()) {
          if (inst._relations.has(relName)) parents.push(inst);
        }
        if (parents.length === 0) continue;
        try {
          await eagerLoad(this, cls, parents, { [relName]: true });
        } catch {
          // Swallow background-refresh failures — the cached (stale)
          // promise stays in place, which is better than crashing.
        }
      }
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

  async _loadRelation(entity: Entity, rel: RelationDef): Promise<unknown> {
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
      rel.localKey === parentSchema.primaryKey ? entity.id : await entity._getField(rel.localKey);
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
    return rel.kind === "hasOne" ? (instances[0] ?? null) : instances;
  }

  // ---- mutations ----

  async insert<T extends Entity>(cls: EntityClass<T>, data: Record<string, unknown>): Promise<T> {
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

  async update<T extends Entity>(entity: T, patch: Record<string, unknown>): Promise<T> {
    const schema = entity._schema();
    const cols = Object.keys(patch).filter((k) => k in schema.fields && k !== schema.primaryKey);
    if (cols.length === 0) return entity;
    const values = cols.map((c) => encode(schema.fields[c], patch[c]));
    const set = cols.map((c) => `"${c}" = ?`).join(", ");
    await this.driver.run(`UPDATE "${schema.table}" SET ${set} WHERE "${schema.primaryKey}" = ?`, [
      ...values,
      entity.id,
    ]);
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
    await this.driver.run(`DELETE FROM "${schema.table}" WHERE "${schema.primaryKey}" = ?`, [
      entity.id,
    ]);
    this._identity.get(schema.name)?.delete(entity.id);
    // Reactive driver wrapper already notified on the DELETE.
  }

  // ---- queries ----

  findAll<T extends Entity>(cls: EntityClass<T>, opts: QueryOptions = {}): Query<T[]> {
    return this._getOrCreateQuery<T[]>(cls, opts, "findAll");
  }

  findFirst<T extends Entity>(cls: EntityClass<T>, opts: QueryOptions = {}): Query<T | null> {
    return this._getOrCreateQuery<T | null>(cls, opts, "findFirst");
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

  /** Drop every cached Query. Any held-onto handles will keep working. */
  clearQueryCache(): void {
    for (const q of this._queryCache.values()) q.dispose();
    this._queryCache.clear();
    for (const q of this._sqlCache.values()) q.dispose();
    this._sqlCache.clear();
  }

  /**
   * Run an arbitrary SELECT and get back a reactive, self-refetching
   * array of row objects. Designed for aggregate / join queries the
   * entity-level `findAll` can't express. Consumes like any other
   * reactive query:
   *
   *   const rows = use(orm.sqlQuery<{ name: string; total: number }>(
   *     `SELECT c.name, SUM(t.amount) AS total
   *        FROM transactions t JOIN categories c ON c.id = t.categoryId
   *       WHERE t.amount < 0
   *       GROUP BY c.id`,
   *   ));
   *
   * Every refetch triggered by a mutation to an involved table is
   * diffed against the previous rows and patched in place — object
   * identity is preserved per row, and only the leaf `.total`
   * observers of rows whose totals actually moved fire. Components
   * that read other columns stay still.
   *
   * By default the involved tables are inferred from `FROM` / `JOIN`.
   * Pass `watch: [...]` to override, or `keyBy: (row) => row.id` to
   * match rows across re-orderings.
   */
  /**
   * Kysely form — pass a builder callback and get strongly-typed rows
   * for free:
   *
   *   const rows = use(orm.sqlQuery((db) => db
   *     .selectFrom('categories as c')
   *     .innerJoin('transactions as t', 't.categoryId', 'c.id')
   *     .select(['c.id', 'c.name'])
   *     .select(eb => eb.fn.sum('t.amount').as('total'))
   *     .groupBy('c.id'),
   *     { keyBy: (r) => r.id }))
   *
   * No explicit generic needed; the row shape comes from kysely.
   */
  sqlQuery<Output>(
    build: (db: Kysely<DB>) => Compilable<Output>,
    options?: SqlQueryOptions<Output>,
  ): SqlQuery<Output>;
  /** Raw-SQL form — use when you need something kysely can't express. */
  sqlQuery<Output = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
    options?: SqlQueryOptions<Output>,
  ): SqlQuery<Output>;
  sqlQuery<Output>(
    arg0: string | ((db: Kysely<DB>) => Compilable<Output>),
    arg1?: readonly unknown[] | SqlQueryOptions<Output>,
    arg2?: SqlQueryOptions<Output>,
  ): SqlQuery<Output> {
    let sql: string;
    let params: readonly unknown[];
    let options: SqlQueryOptions<Output>;
    if (typeof arg0 === "function") {
      const compiled = arg0(this.kysely).compile();
      sql = compiled.sql;
      params = compiled.parameters;
      options = (arg1 as SqlQueryOptions<Output>) ?? {};
    } else {
      sql = arg0;
      params = (arg1 as readonly unknown[] | undefined) ?? [];
      options = arg2 ?? {};
    }
    const key = sqlKey(sql, params, options);
    const cached = this._sqlCache.get(key);
    if (cached) return cached as SqlQuery<Output>;
    const q = new SqlQuery<Output>(this, sql, params, options);
    this._sqlCache.set(key, q as unknown as SqlQuery<unknown>);
    return q;
  }

  private _getOrCreateQuery<T>(
    cls: EntityClass<Entity>,
    opts: QueryOptions,
    kind: QueryKind,
  ): Query<T> {
    const key = queryKey(kind, cls.schema.name, opts);
    const cached = this._queryCache.get(key);
    if (cached) return cached as Query<T>;
    const q = new Query<T>(this, cls, opts, kind);
    this._queryCache.set(key, q as unknown as Query<unknown>);
    return q;
  }

  /**
   * Run `fn` inside a SQL transaction. Concurrent calls are serialised
   * — if two calls overlap, the second waits for the first to COMMIT
   * (or ROLLBACK) before starting its own BEGIN. This is the only way
   * to safely run multi-statement mutations when the caller can't
   * guarantee there's no other in-flight write, since SQLite has
   * exactly one transaction slot per connection.
   *
   * All writes through `this.driver` — including the ORM's own
   * `insert` / `update` / `delete` and arbitrary `driver.run(...)`
   * from inside `fn` — participate in the same transaction. The
   * reactive wrapper defers notifications for the duration; one
   * batched invalidation fires at COMMIT. Throwing from `fn` triggers
   * ROLLBACK and propagates the error.
   *
   * Do **not** nest `orm.transaction` calls in each other — the outer
   * call holds the mutex and the inner would deadlock. Open a single
   * transaction and call plain `this.driver.run` inside.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const ticket = new Promise<void>((r) => {
      release = r;
    });
    const wait = this._txChain;
    this._txChain = ticket;
    try {
      await wait;
      await this.driver.run("BEGIN");
      try {
        const result = await fn();
        await this.driver.run("COMMIT");
        return result;
      } catch (e) {
        try {
          await this.driver.run("ROLLBACK");
        } catch {
          // Rollback after a failed COMMIT can itself fail on some
          // connection states; the original error is what the caller
          // cares about.
        }
        throw e;
      }
    } finally {
      release();
    }
  }

  async close(): Promise<void> {
    await this.driver.close?.();
  }
}
