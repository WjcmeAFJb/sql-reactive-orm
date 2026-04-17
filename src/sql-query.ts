import {
  IObservableArray,
  makeObservable,
  observable,
  runInAction,
} from "mobx";
import type { Orm } from "./orm.js";

export interface SqlQueryOptions<T> {
  /**
   * Tables whose mutations should trigger a re-run. When omitted, the
   * SQL is scanned for `FROM` / `JOIN <name>` and those tables are
   * watched automatically.
   */
  watch?: readonly string[];
  /**
   * How to match a new row to a previous one for in-place patching.
   * Without it the diff is positional (`newRows[i]` ↔ `oldRows[i]`).
   * With it, rows are paired by key — so a re-ordered result still
   * preserves object identity per row.
   */
  keyBy?: (row: T) => unknown;
}

/**
 * A live, self-refetching handle around an arbitrary SQL SELECT.
 *
 * React 19's `use(sqlQuery)` returns the current rows array. On the
 * first run the component suspends; subsequent refetches mutate the
 * same row objects in place so observers that read only the
 * *unchanged* columns don't re-render. Concretely: if the query
 * returns 6 rows with 6 numbers and next time 6 rows with the same
 * identity but two numbers changed, exactly two MobX observers fire
 * — not six, not all of them, just the two components that read the
 * two columns whose values moved.
 *
 * The diff is deep: nested objects and arrays are patched recursively
 * via the same algorithm. A row that's been inserted / removed
 * between refetches still triggers the coarse `.length` observer, so
 * lists add / drop items reactively.
 */
export class SqlQuery<T extends Record<string, unknown> = Record<string, unknown>>
  implements Promise<T[]>
{
  readonly [Symbol.toStringTag] = "SqlQuery";

  status: "pending" | "fulfilled" | "rejected" = "pending";
  /** The patched-in-place observable array. Stable identity per row. */
  value: IObservableArray<T> = observable.array<T>([], { deep: false });
  reason: unknown = undefined;

  private _currentPromise: Promise<T[]>;
  private _unsubscribe: (() => void) | null = null;
  private _disposed = false;
  private _runId = 0;

  constructor(
    private readonly _orm: Orm,
    private readonly _sql: string,
    private readonly _params: readonly unknown[],
    private readonly _options: SqlQueryOptions<T>,
  ) {
    makeObservable(this, {
      status: observable,
      value: observable.ref,
      reason: observable.ref,
    });
    const watch = new Set(
      _options.watch && _options.watch.length > 0
        ? _options.watch
        : detectReadTables(_sql),
    );
    if (watch.size > 0) {
      this._unsubscribe = this._orm._subscribe(watch, () => {
        if (!this._disposed) this._execute();
      });
    }
    this._currentPromise = this._execute();
  }

  // ---- Promise<T[]> ----

  then<U = T[], V = never>(
    onFulfilled?: ((value: T[]) => U | PromiseLike<U>) | null,
    onRejected?: ((reason: unknown) => V | PromiseLike<V>) | null,
  ): Promise<U | V> {
    return this._currentPromise.then(onFulfilled, onRejected);
  }
  catch<V = never>(
    onRejected?: ((reason: unknown) => V | PromiseLike<V>) | null,
  ): Promise<T[] | V> {
    return this._currentPromise.catch(onRejected);
  }
  finally(onFinally?: (() => void) | null): Promise<T[]> {
    return this._currentPromise.finally(onFinally);
  }

  // ---- control ----

  refetch(): Promise<T[]> {
    this._currentPromise = this._execute();
    return this._currentPromise;
  }

  dispose(): void {
    this._disposed = true;
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  // ---- internal ----

  private async _execute(): Promise<T[]> {
    const id = ++this._runId;
    try {
      const rows = await this._orm.driver.all<T>(this._sql, this._params);
      if (id !== this._runId) return rows;
      runInAction(() => {
        if (this.status !== "fulfilled") {
          this.value.replace(rows.map((r) => observable.object(r) as T));
          this.status = "fulfilled";
        } else {
          this._patchArray(this.value, rows);
        }
        this.reason = undefined;
      });
      return this.value.slice();
    } catch (e) {
      if (id !== this._runId) throw e;
      runInAction(() => {
        this.status = "rejected";
        this.reason = e;
      });
      throw e;
    }
  }

  private _patchArray(target: IObservableArray<T>, incoming: T[]): void {
    const keyBy = this._options.keyBy;
    if (keyBy) {
      patchByKey(target, incoming, keyBy as (row: T) => unknown);
    } else {
      patchByPosition(target, incoming);
    }
  }
}

// ---- reusable patch algorithm ----

/**
 * Mutate `target` into the shape of `incoming` with the *fewest*
 * replacements possible, so that any object identity shared between
 * the old and new states survives. Works for plain objects and arrays
 * recursively; anything else is treated as a leaf and replaced with
 * `===` equality.
 */
export function patchInto(target: unknown, incoming: unknown): unknown {
  if (Object.is(target, incoming)) return target;
  if (isPlainObject(target) && isPlainObject(incoming)) {
    patchObject(target, incoming);
    return target;
  }
  if (Array.isArray(target) && Array.isArray(incoming)) {
    patchArrayPositional(
      target as unknown as IObservableArray<unknown> | unknown[],
      incoming,
    );
    return target;
  }
  return incoming;
}

function patchObject(
  target: Record<string, unknown>,
  incoming: Record<string, unknown>,
): void {
  // Remove keys that disappeared first, so observer reads during the
  // same action don't see a half-shaped object if they also read
  // newly-added keys.
  for (const key of Object.keys(target)) {
    if (!(key in incoming)) delete target[key];
  }
  for (const key of Object.keys(incoming)) {
    const oldV = target[key];
    const newV = incoming[key];
    if (Object.is(oldV, newV)) continue;
    if (isPlainObject(oldV) && isPlainObject(newV)) {
      patchObject(oldV, newV);
    } else if (Array.isArray(oldV) && Array.isArray(newV)) {
      patchArrayPositional(oldV, newV);
    } else {
      target[key] = newV;
    }
  }
}

function patchArrayPositional<E>(
  target: IObservableArray<E> | E[],
  incoming: E[],
): void {
  const minLen = Math.min(target.length, incoming.length);
  for (let i = 0; i < minLen; i++) {
    const oV = target[i];
    const nV = incoming[i];
    if (Object.is(oV, nV)) continue;
    if (isPlainObject(oV) && isPlainObject(nV)) {
      patchObject(oV, nV);
    } else if (Array.isArray(oV) && Array.isArray(nV)) {
      patchArrayPositional(oV, nV);
    } else {
      target[i] = nV;
    }
  }
  if (incoming.length > target.length) {
    for (let i = minLen; i < incoming.length; i++) target.push(incoming[i]!);
  } else if (incoming.length < target.length) {
    if (isObservableArray(target)) {
      target.splice(incoming.length, target.length - incoming.length);
    } else {
      (target as E[]).length = incoming.length;
    }
  }
}

function patchByPosition<T extends Record<string, unknown>>(
  target: IObservableArray<T>,
  incoming: T[],
): void {
  const minLen = Math.min(target.length, incoming.length);
  for (let i = 0; i < minLen; i++) {
    patchObject(
      target[i] as Record<string, unknown>,
      incoming[i] as Record<string, unknown>,
    );
  }
  if (incoming.length > target.length) {
    for (let i = minLen; i < incoming.length; i++) {
      target.push(observable.object(incoming[i]!) as T);
    }
  } else if (incoming.length < target.length) {
    target.splice(incoming.length, target.length - incoming.length);
  }
}

function patchByKey<T extends Record<string, unknown>>(
  target: IObservableArray<T>,
  incoming: T[],
  keyBy: (row: T) => unknown,
): void {
  const byKey = new Map<unknown, T>();
  for (const row of target) byKey.set(keyBy(row), row);
  const next: T[] = new Array(incoming.length);
  for (let i = 0; i < incoming.length; i++) {
    const row = incoming[i]!;
    const k = keyBy(row);
    const existing = byKey.get(k);
    if (existing !== undefined) {
      patchObject(
        existing as Record<string, unknown>,
        row as Record<string, unknown>,
      );
      next[i] = existing;
      byKey.delete(k);
    } else {
      next[i] = observable.object(row) as T;
    }
  }
  // Only call .replace if the sequence actually changed — a reordered
  // array triggers one `.length` / indexed-access notification regardless.
  let sameSequence = target.length === next.length;
  if (sameSequence) {
    for (let i = 0; i < next.length; i++) {
      if (target[i] !== next[i]) {
        sameSequence = false;
        break;
      }
    }
  }
  if (!sameSequence) target.replace(next);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isObservableArray<E>(
  v: IObservableArray<E> | E[],
): v is IObservableArray<E> {
  return (
    typeof (v as IObservableArray<E>).replace === "function" &&
    typeof (v as IObservableArray<E>).clear === "function"
  );
}

// ---- SELECT table detection ----

const FROM_RE = /\bFROM\s+("([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][\w$]*))/gi;
const JOIN_RE = /\bJOIN\s+("([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][\w$]*))/gi;

/** Heuristic: pull FROM / JOIN table names out of a SELECT. */
export function detectReadTables(sql: string): Set<string> {
  const out = new Set<string>();
  const stripped = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const re of [FROM_RE, JOIN_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      const name = m[2] ?? m[3] ?? m[4] ?? m[5];
      if (name) out.add(name);
    }
  }
  return out;
}

/** Augments `use(sqlQuery)` so React 19 accepts it as a thenable of `T[]`. */
declare module "react" {
  function use<T extends Record<string, unknown>>(q: SqlQuery<T>): T[];
}
