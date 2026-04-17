/**
 * React 19's `use` hook reads `.status` / `.value` / `.reason` off a thenable
 * to skip re-suspending when the data is already available. When we know the
 * value up front (identity-map hit, eager load, row already cached) we stamp
 * the returned Promise so `use(entity.field)` never suspends unnecessarily.
 *
 * For promises we created ourselves (row loads, relation loads) we attach a
 * lightweight tracker so React can also fast-path them on subsequent renders
 * after they resolve — this matches what `use` would do internally, but doing
 * it here keeps the stamping symmetric with pre-resolved promises.
 */

/**
 * Shape React 19 reads off a thenable passed to `use`. We widen to a union
 * rather than a single interface with optional fields, so `use(promise)`
 * type-checks — React's declaration expects one of these three variants.
 */
export type TrackedPromise<T> =
  | (Promise<T> & { status: "pending" })
  | (Promise<T> & { status: "fulfilled"; value: T })
  | (Promise<T> & { status: "rejected"; reason: unknown });

type MutThenable<T> = Promise<T> & {
  status?: "pending" | "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
};

export function resolved<T>(value: T): TrackedPromise<T> {
  const p = Promise.resolve(value) as MutThenable<T>;
  p.status = "fulfilled";
  p.value = value;
  return p as TrackedPromise<T>;
}

export function rejected<T = never>(reason: unknown): TrackedPromise<T> {
  const p = Promise.reject(reason) as MutThenable<T>;
  p.catch(() => {});
  p.status = "rejected";
  p.reason = reason;
  return p as TrackedPromise<T>;
}

export function track<T>(promise: Promise<T>): TrackedPromise<T> {
  const p = promise as MutThenable<T>;
  if (p.status) return p as TrackedPromise<T>;
  p.status = "pending";
  promise.then(
    (v) => {
      p.status = "fulfilled";
      p.value = v;
    },
    (e) => {
      p.status = "rejected";
      p.reason = e;
    },
  );
  return p as TrackedPromise<T>;
}

export function isFulfilled<T>(
  p: Promise<T>,
): p is Promise<T> & { status: "fulfilled"; value: T } {
  return (p as MutThenable<T>).status === "fulfilled";
}
