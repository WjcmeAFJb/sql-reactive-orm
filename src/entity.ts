import { makeObservable, observable, runInAction } from "mobx";
import { isFulfilled, resolved } from "./promise-utils.js";
import type { EntityClass, EntitySchema, FieldDef } from "./schema.js";
import type { Orm } from "./orm.js";

/**
 * Entity base class. Subclasses declare their schema; the ORM installs
 * reactive getters for each field and relation at registration time. All
 * getters return Promises — they resolve synchronously via `resolved()`
 * when data is already loaded (identity-map hit or eager load) so React's
 * `use` won't suspend unnecessarily, and they hit the driver lazily on
 * first access otherwise.
 *
 * The instance holds two pieces of reactive state:
 *   - `_row`: the raw row as an observable ref. Replacing it (via
 *     `_applyRow` after an update) causes any observer tracking a
 *     downstream field to re-render with the new value.
 *   - `_relations`: an observable shallow map of relation name → resolved
 *     Promise. Eager loading (`with` clause) primes this; lazy access
 *     fills it from the DB.
 *
 * Two non-observable caches de-dup in-flight work:
 *   - `_pendingFieldCache`: while the row is loading, multiple field
 *     accesses share the same chained promise.
 *   - `_pendingRelations`: same idea for relation loads.
 *
 * When the row changes, field promises are re-derived keyed by row
 * identity via a WeakMap, which lets the old promises be GC'd alongside
 * the old row object.
 */
export abstract class Entity {
  readonly id: unknown;

  /** observable.ref — null until the row is loaded. */
  _row: Record<string, unknown> | null = null;

  /** observable.shallow map — set on eager load / resolution. */
  _relations: Map<string, Promise<unknown>> = new Map();

  // --- non-observable de-dup caches ---
  private _rowLoad: Promise<Record<string, unknown>> | null = null;
  private readonly _pendingFieldCache: Map<string, Promise<unknown>> = new Map();
  private readonly _pendingRelations: Map<string, Promise<unknown>> = new Map();
  private readonly _rowScopedCache: WeakMap<
    object,
    Map<string, Promise<unknown>>
  > = new WeakMap();

  /**
   * Instances are created exclusively by the ORM identity map. Do not
   * construct directly — call `orm.find(MyEntity, id)` or the result of
   * `orm.insert()` etc.
   */
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public readonly _orm: Orm<any>,
    id: unknown,
  ) {
    this.id = id;
    makeObservable<Entity, "_row" | "_relations">(this, {
      _row: observable.ref,
      _relations: observable.shallow,
    });
  }

  static schema: EntitySchema;

  _schema(): EntitySchema {
    return (this.constructor as EntityClass).schema;
  }

  // ---- field access ----

  /** Internal — invoked by the generated getter installed on the prototype. */
  _getField(name: string): Promise<unknown> {
    // Tracks `_row` observable so replacing the row re-runs observers.
    const row = this._row;
    if (row !== null && name in row) {
      let m = this._rowScopedCache.get(row);
      if (!m) {
        m = new Map();
        this._rowScopedCache.set(row, m);
      }
      let cached = m.get(name);
      if (!cached) {
        cached = resolved(this._decode(name, row[name]));
        m.set(name, cached);
      }
      return cached;
    }
    // Row not loaded / field absent from partial projection — kick off a
    // row load. All concurrent pending field reads share `this._rowLoad`.
    let pending = this._pendingFieldCache.get(name);
    if (!pending) {
      pending = this._fetchField(name);
      this._pendingFieldCache.set(name, pending);
    }
    return pending;
  }

  private _fetchField(name: string): Promise<unknown> {
    if (!this._rowLoad) {
      // Let React 19's `use` own the status-stamping on the returned
      // promise — pre-stamping a pending thenable confuses React's
      // Suspense ping scheduler.
      this._rowLoad = this._orm._loadRow(this).then((row) => {
        runInAction(() => {
          this._row = row;
          this._rowLoad = null;
          this._pendingFieldCache.clear();
        });
        return row;
      });
    }
    return this._rowLoad.then((row) => this._decode(name, row[name]));
  }

  // ---- relation access ----

  _getRelation(name: string): Promise<unknown> {
    const cached = this._relations.get(name);
    if (cached) return cached;

    let pending = this._pendingRelations.get(name);
    if (!pending) {
      pending = this._fetchRelation(name);
      this._pendingRelations.set(name, pending);
    }
    return pending;
  }

  private _fetchRelation(name: string): Promise<unknown> {
    const rel = this._schema().relations[name];
    if (!rel)
      throw new Error(
        `No relation "${name}" on entity "${this._schema().name}"`,
      );
    return this._orm._loadRelation(this, rel).then((value) => {
      // Route through `_applyRelation` so the shallow-compare fast-path
      // kicks in here too (relevant for lazy relation reads that race
      // with an eager refresh of the same relation).
      this._applyRelation(name, value);
      return value;
    });
  }

  // ---- apply (called by ORM during queries / inserts / updates) ----

  /**
   * Replace the row data with a fresh copy. Observers tracking any field
   * re-render. Pending field reads for the old row are discarded — they
   * will have resolved (or will resolve) to old-row values, which is
   * acceptable: new reads get fresh data via the new row.
   *
   * If the new row is shallow-equal to the current one, skip the write
   * entirely: `_row` is an `observable.ref`, so assigning a fresh object
   * with the same column values would still fan out a MobX notification
   * and re-render every observing component for no real change. That
   * matters here because the ORM can legitimately call `_applyRow` more
   * than once per mutation (e.g. `orm.update` re-reads the row *and* the
   * post-write identity-map refresh in `_notifyTable` re-reads it).
   */
  _applyRow(row: Record<string, unknown>): void {
    if (this._row !== null && rowsShallowEqual(this._row, row)) {
      runInAction(() => {
        this._rowLoad = null;
        this._pendingFieldCache.clear();
      });
      return;
    }
    runInAction(() => {
      this._row = row;
      this._pendingFieldCache.clear();
      this._rowLoad = null;
    });
  }

  /** Merge partial row (from column projection) with existing row. */
  _applyPartialRow(partial: Record<string, unknown>): void {
    runInAction(() => {
      this._row = { ...(this._row ?? {}), ...partial };
      // Only invalidate pending promises for fields we just set.
      for (const key of Object.keys(partial)) {
        this._pendingFieldCache.delete(key);
      }
    });
  }

  /**
   * Store or replace a relation's resolved value. Shallow-compares
   * against the currently-cached value first: for belongsTo that's a
   * single entity reference, for hasMany a sequence. Because the
   * identity map hands back the same JS object for a given (table, id),
   * the common case of "refetched, same shape" never triggers a MobX
   * write, and therefore never re-renders the observers that read the
   * relation. Skipping those no-op writes is what makes queries with a
   * `with` clause not thrash the UI after every mutation.
   */
  _applyRelation(name: string, value: unknown): void {
    const existing = this._relations.get(name);
    if (existing && relationValuesEqual(existing, value)) {
      this._pendingRelations.delete(name);
      return;
    }
    runInAction(() => {
      this._relations.set(name, resolved(value));
      this._pendingRelations.delete(name);
    });
  }

  /** Drop all cached data. Next access re-fetches. */
  _invalidate(): void {
    runInAction(() => {
      this._row = null;
      this._rowLoad = null;
      this._pendingFieldCache.clear();
      this._relations = new Map();
      this._pendingRelations.clear();
    });
  }

  _invalidateRelations(targetTable?: string): void {
    const schema = this._schema();
    runInAction(() => {
      for (const [name, rel] of Object.entries(schema.relations)) {
        if (targetTable && rel.target().schema.table !== targetTable) continue;
        this._relations.delete(name);
        this._pendingRelations.delete(name);
      }
    });
  }

  // ---- value codec ----

  _decode(name: string, raw: unknown): unknown {
    const def: FieldDef | undefined = this._schema().fields[name];
    if (!def) return raw;
    if (raw == null) return raw;
    if (def.json && typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    if (def.boolean) return !!raw;
    return raw;
  }
}

function rowsShallowEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function relationValuesEqual(
  cached: Promise<unknown>,
  next: unknown,
): boolean {
  if (!isFulfilled(cached)) return false;
  const prev = cached.value;
  if (prev === next) return true;
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i++) {
      if (prev[i] !== next[i]) return false;
    }
    return true;
  }
  return false;
}

/**
 * Install reactive `{field}` and `{relation}` getters on an entity class's
 * prototype. Called by `Orm.register`.
 */
export function installAccessors(cls: EntityClass): void {
  const proto = cls.prototype as Record<string, unknown>;
  const schema = cls.schema;
  for (const fieldName of Object.keys(schema.fields)) {
    if (fieldName === schema.primaryKey) continue;
    if (Object.prototype.hasOwnProperty.call(proto, fieldName)) continue;
    Object.defineProperty(proto, fieldName, {
      configurable: true,
      enumerable: true,
      get(this: Entity) {
        return this._getField(fieldName);
      },
    });
  }
  for (const relName of Object.keys(schema.relations)) {
    if (Object.prototype.hasOwnProperty.call(proto, relName)) continue;
    Object.defineProperty(proto, relName, {
      configurable: true,
      enumerable: true,
      get(this: Entity) {
        return this._getRelation(relName);
      },
    });
  }
}
