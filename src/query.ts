import { makeObservable, observable, runInAction } from "mobx";
import { Entity } from "./entity.js";
import { resolved, type TrackedPromise } from "./promise-utils.js";
import type { EntityClass, RelationDef } from "./schema.js";
import type { Orm } from "./orm.js";

// ---- public types ----

export type WhereValue = string | number | boolean | null | bigint | Uint8Array;

export type WhereOp =
  | { eq: WhereValue }
  | { ne: WhereValue }
  | { gt: WhereValue }
  | { gte: WhereValue }
  | { lt: WhereValue }
  | { lte: WhereValue }
  | { in: readonly WhereValue[] }
  | { nin: readonly WhereValue[] }
  | { like: string }
  | { notLike: string }
  | { isNull: true }
  | { isNotNull: true };

export type WhereClause = { [field: string]: WhereValue | WhereOp };

export type WithClause =
  | string
  | readonly (string | Record<string, WithClause>)[]
  | { [relation: string]: true | WithClause };

export type OrderDir = "asc" | "desc";
export type OrderBy =
  | string
  | readonly (string | readonly [string, OrderDir])[];

export interface QueryOptions {
  where?: WhereClause;
  select?: readonly string[];
  with?: WithClause;
  orderBy?: OrderBy;
  limit?: number;
  offset?: number;
}

type QueryKind = "findAll" | "findFirst";

// ---- sql builders ----

const OPS: Record<string, string> = {
  eq: "=",
  ne: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "LIKE",
  notLike: "NOT LIKE",
};

export function buildWhere(where?: WhereClause): {
  sql: string;
  params: unknown[];
} {
  if (!where) return { sql: "", params: [] };
  const params: unknown[] = [];
  const parts: string[] = [];
  for (const [field, raw] of Object.entries(where)) {
    const col = `"${field}"`;
    if (raw === null) {
      parts.push(`${col} IS NULL`);
      continue;
    }
    if (
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      !(raw instanceof Uint8Array)
    ) {
      for (const [op, val] of Object.entries(
        raw as Record<string, unknown>,
      )) {
        if (op === "in" || op === "nin") {
          const vals = val as readonly unknown[];
          if (vals.length === 0) {
            parts.push(op === "in" ? "0" : "1"); // empty IN → false
            continue;
          }
          const ph = vals.map(() => "?").join(",");
          parts.push(`${col} ${op === "in" ? "IN" : "NOT IN"} (${ph})`);
          params.push(...vals);
        } else if (op === "isNull") {
          parts.push(`${col} IS NULL`);
        } else if (op === "isNotNull") {
          parts.push(`${col} IS NOT NULL`);
        } else if (op in OPS) {
          parts.push(`${col} ${OPS[op]} ?`);
          params.push(val);
        } else {
          throw new Error(`Unknown where operator "${op}"`);
        }
      }
      continue;
    }
    parts.push(`${col} = ?`);
    params.push(raw);
  }
  return {
    sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "",
    params,
  };
}

export function buildOrderBy(order: OrderBy): string {
  const items = typeof order === "string" ? [order] : order;
  return items
    .map((item) => {
      if (typeof item === "string") return `"${item}"`;
      const [col, dir] = item;
      return `"${col}" ${dir === "desc" ? "DESC" : "ASC"}`;
    })
    .join(", ");
}

interface WithSpec {
  [relation: string]: true | WithSpec;
}

export function expandWith(w: WithClause | undefined): WithSpec {
  if (!w) return {};
  if (typeof w === "string") return { [w]: true };
  if (Array.isArray(w)) {
    const out: WithSpec = {};
    for (const item of w) {
      if (typeof item === "string") out[item] = true;
      else Object.assign(out, expandWith(item as WithClause));
    }
    return out;
  }
  const out: WithSpec = {};
  for (const [k, v] of Object.entries(w as Record<string, unknown>)) {
    out[k] = v === true ? true : expandWith(v as WithClause);
  }
  return out;
}

// ---- Query ----

/**
 * A reactive query handle. Fields (`promise`, `result`, `loading`, `error`)
 * are MobX observables — read them inside an `observer` component and the
 * component re-renders automatically.
 *
 * The query subscribes to mutations on the involved tables (the target
 * table plus any tables named in `with`) and refetches on change. Pass
 * `query.promise` to React's `use` to get Suspense-compatible access, or
 * `await query` directly for imperative flows — the instance is itself a
 * thenable.
 *
 * Call `dispose()` when the query is no longer needed to drop the
 * subscription; in React this is typically done in a `useEffect` cleanup.
 */
export class Query<T> implements PromiseLike<T> {
  promise: TrackedPromise<T>;
  result: T | undefined = undefined;
  loading = true;
  error: unknown = null;

  private readonly _involved: Set<string>;
  private _unsubscribe: (() => void) | null = null;
  private _disposed = false;
  private _runId = 0;

  constructor(
    private readonly _orm: Orm,
    private readonly _cls: EntityClass<Entity>,
    private readonly _opts: QueryOptions,
    private readonly _kind: QueryKind,
  ) {
    this.promise = resolved(undefined as unknown as T);
    makeObservable(this, {
      promise: observable.ref,
      result: observable.ref,
      loading: observable,
      error: observable.ref,
    });
    this._involved = this._computeInvolvedTables();
    this._unsubscribe = this._orm._subscribe(this._involved, () => {
      if (!this._disposed) this._execute();
    });
    this._execute();
  }

  then<U = T, V = never>(
    onFulfilled?: ((value: T) => U | PromiseLike<U>) | null,
    onRejected?: ((reason: unknown) => V | PromiseLike<V>) | null,
  ): Promise<U | V> {
    return this.promise.then(onFulfilled, onRejected);
  }

  refetch(): Promise<T> {
    this._execute();
    return this.promise;
  }

  dispose(): void {
    this._disposed = true;
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  // ---- internal ----

  private _execute(): void {
    const id = ++this._runId;
    const p = this._run(id);
    // Don't pre-stamp pending status — React's `use` owns that transition.
    // On resolution we swap in a pre-stamped fulfilled promise so subsequent
    // observer reads don't re-suspend.
    runInAction(() => {
      this.promise = p as TrackedPromise<T>;
      this.loading = true;
      this.error = null;
    });
    p.then(
      (value) => {
        if (id !== this._runId) return;
        runInAction(() => {
          this.promise = resolved(value);
          this.result = value;
          this.loading = false;
        });
      },
      (err) => {
        if (id !== this._runId) return;
        runInAction(() => {
          this.error = err;
          this.loading = false;
        });
      },
    );
  }

  private async _run(_id: number): Promise<T> {
    const schema = this._cls.schema;
    const selectCols = this._opts.select
      ? Array.from(new Set([schema.primaryKey, ...this._opts.select]))
          .map((c) => `"${c}"`)
          .join(", ")
      : "*";
    const { sql: whereSql, params } = buildWhere(this._opts.where);
    let sql = `SELECT ${selectCols} FROM "${schema.table}"`;
    if (whereSql) sql += ` ${whereSql}`;
    if (this._opts.orderBy) sql += ` ORDER BY ${buildOrderBy(this._opts.orderBy)}`;
    const effectiveLimit =
      this._kind === "findFirst"
        ? 1
        : this._opts.limit !== undefined
          ? this._opts.limit
          : undefined;
    if (effectiveLimit !== undefined) sql += ` LIMIT ${effectiveLimit}`;
    if (this._opts.offset !== undefined) sql += ` OFFSET ${this._opts.offset}`;

    const rows = await this._orm.driver.all<Record<string, unknown>>(sql, params);

    const instances: Entity[] = rows.map((row) => {
      const inst = this._orm._getOrCreate(this._cls, row[schema.primaryKey]);
      if (this._opts.select) inst._applyPartialRow(row);
      else inst._applyRow(row);
      return inst;
    });

    if (this._opts.with) {
      await eagerLoad(this._orm, this._cls, instances, expandWith(this._opts.with));
    }

    if (this._kind === "findAll") return instances as unknown as T;
    return (instances[0] ?? null) as unknown as T;
  }

  private _computeInvolvedTables(): Set<string> {
    const s = new Set<string>();
    collectTables(this._cls, expandWith(this._opts.with), s);
    return s;
  }
}

function collectTables(
  cls: EntityClass<Entity>,
  withSpec: WithSpec,
  out: Set<string>,
): void {
  out.add(cls.schema.table);
  for (const [relName, nested] of Object.entries(withSpec)) {
    const rel = cls.schema.relations[relName];
    if (!rel) continue;
    const targetCls = rel.target();
    collectTables(targetCls, nested === true ? {} : nested, out);
  }
}

// ---- eager loading ----

export async function eagerLoad(
  orm: Orm,
  parentCls: EntityClass<Entity>,
  parents: Entity[],
  withSpec: WithSpec,
): Promise<void> {
  if (parents.length === 0) return;
  for (const [relName, nested] of Object.entries(withSpec)) {
    const rel = parentCls.schema.relations[relName];
    if (!rel)
      throw new Error(
        `Unknown relation "${relName}" on ${parentCls.schema.name}`,
      );
    const children = await loadRelationBatch(orm, parentCls, parents, relName, rel);
    if (nested !== true && children.length > 0) {
      await eagerLoad(orm, rel.target(), children, nested);
    }
  }
}

async function loadRelationBatch(
  orm: Orm,
  parentCls: EntityClass<Entity>,
  parents: Entity[],
  relName: string,
  rel: RelationDef,
): Promise<Entity[]> {
  const TargetCls = rel.target();
  const targetSchema = TargetCls.schema;
  const parentSchema = parentCls.schema;
  const children: Entity[] = [];

  if (rel.kind === "belongsTo") {
    // this.foreignKey → target.id
    const fkValues = new Set<unknown>();
    const parentFks = new Map<Entity, unknown>();
    for (const p of parents) {
      const fk = await p._getField(rel.foreignKey);
      parentFks.set(p, fk);
      if (fk != null) fkValues.add(fk);
    }
    if (fkValues.size === 0) {
      for (const p of parents) p._applyRelation(relName, null);
      return children;
    }
    const ph = Array.from(fkValues, () => "?").join(",");
    const rows = await orm.driver.all<Record<string, unknown>>(
      `SELECT * FROM "${targetSchema.table}" WHERE "${rel.localKey}" IN (${ph})`,
      Array.from(fkValues),
    );
    const byId = new Map<unknown, Entity>();
    for (const row of rows) {
      const inst = orm._getOrCreate(TargetCls, row[targetSchema.primaryKey]);
      inst._applyRow(row);
      byId.set(row[rel.localKey], inst);
      children.push(inst);
    }
    for (const p of parents) {
      const fk = parentFks.get(p);
      p._applyRelation(relName, fk != null ? byId.get(fk) ?? null : null);
    }
    return children;
  }

  // hasMany / hasOne — this.localKey appears as target.foreignKey
  const parentKeys = new Set<unknown>();
  const parentLocal = new Map<Entity, unknown>();
  for (const p of parents) {
    const v =
      rel.localKey === parentSchema.primaryKey
        ? p.id
        : await p._getField(rel.localKey);
    parentLocal.set(p, v);
    if (v != null) parentKeys.add(v);
  }
  if (parentKeys.size === 0) {
    for (const p of parents)
      p._applyRelation(relName, rel.kind === "hasOne" ? null : []);
    return children;
  }
  const ph = Array.from(parentKeys, () => "?").join(",");
  const rows = await orm.driver.all<Record<string, unknown>>(
    `SELECT * FROM "${targetSchema.table}" WHERE "${rel.foreignKey}" IN (${ph})`,
    Array.from(parentKeys),
  );
  const byFk = new Map<unknown, Entity[]>();
  for (const row of rows) {
    const inst = orm._getOrCreate(TargetCls, row[targetSchema.primaryKey]);
    inst._applyRow(row);
    children.push(inst);
    const fk = row[rel.foreignKey];
    let arr = byFk.get(fk);
    if (!arr) {
      arr = [];
      byFk.set(fk, arr);
    }
    arr.push(inst);
  }
  for (const p of parents) {
    const lv = parentLocal.get(p);
    const matches = lv != null ? byFk.get(lv) ?? [] : [];
    p._applyRelation(relName, rel.kind === "hasOne" ? matches[0] ?? null : matches);
  }
  return children;
}
