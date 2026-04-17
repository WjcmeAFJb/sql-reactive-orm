import { reaction } from "mobx";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Orm, detectReadTables, patchInto } from "../src/index.js";
import { createDriver } from "./helpers/driver.js";
import { User } from "./helpers/entities.js";

let orm: Orm;

beforeEach(async () => {
  orm = new Orm(await createDriver());
  await orm.register(User);
});
afterEach(async () => {
  await orm.close();
});

describe("detectReadTables", () => {
  it("extracts FROM + JOIN table names", () => {
    expect(
      [
        ...detectReadTables(
          "SELECT c.name FROM categories c JOIN transactions t ON t.categoryId = c.id",
        ),
      ].sort(),
    ).toEqual(["categories", "transactions"]);
  });

  it("handles quoted identifiers", () => {
    expect([...detectReadTables('SELECT 1 FROM "users" AS u JOIN `posts` p')]).toEqual([
      "users",
      "posts",
    ]);
  });
});

describe("patchInto (core diff)", () => {
  it("keeps the same target reference when diffing a matching object", () => {
    const target: Record<string, unknown> = { a: 1, b: { c: 2 } };
    const inner = target.b;
    patchInto(target, { a: 1, b: { c: 2 } });
    expect(target.b).toBe(inner); // no change → no replace
  });

  it("mutates leaf keys in place, preserving sibling refs", () => {
    const target = { a: 1, b: 2, c: 3 };
    patchInto(target, { a: 1, b: 20, c: 3 });
    expect(target).toEqual({ a: 1, b: 20, c: 3 });
  });

  it("recurses into nested plain objects rather than replacing them", () => {
    const target: Record<string, unknown> = {
      meta: { by: "alice", at: 1 },
      payload: { n: 5 },
    };
    const metaRef = target.meta;
    const payloadRef = target.payload;
    patchInto(target, {
      meta: { by: "bob", at: 1 },
      payload: { n: 5 },
    });
    expect(target.meta).toBe(metaRef); // still same nested object
    expect(target.payload).toBe(payloadRef);
    expect((target.meta as Record<string, unknown>).by).toBe("bob");
  });

  it("deletes keys that disappeared", () => {
    const target: Record<string, unknown> = { a: 1, b: 2 };
    patchInto(target, { a: 1 });
    expect("b" in target).toBe(false);
  });

  it("patches arrays positionally", () => {
    const target: Record<string, unknown>[] = [{ n: 1 }, { n: 2 }, { n: 3 }];
    const first = target[0];
    const second = target[1];
    patchInto(target, [{ n: 1 }, { n: 22 }, { n: 3 }]);
    expect(target[0]).toBe(first);
    expect(target[1]).toBe(second); // same object, mutated
    expect(target[1]!.n).toBe(22);
  });
});

describe("orm.sqlQuery — reactivity", () => {
  it("runs the query and exposes rows via `value`", async () => {
    await orm.insert(User, { name: "A", email: "a@x", age: 10 });
    await orm.insert(User, { name: "B", email: "b@x", age: 20 });
    const q = orm.sqlQuery<{ n: number; total: number | null }>(
      'SELECT COUNT(*) AS n, SUM(age) AS total FROM "users"',
    );
    await q;
    expect(q.value.length).toBe(1);
    expect(q.value[0]!.n).toBe(2);
    expect(q.value[0]!.total).toBe(30);
    q.dispose();
  });

  it("auto-watches tables in FROM and refetches on mutation", async () => {
    await orm.insert(User, { name: "A", email: "a@x", age: 10 });
    const q = orm.sqlQuery<{ n: number }>('SELECT COUNT(*) AS n FROM "users"');
    await q;
    expect(q.value[0]!.n).toBe(1);

    await orm.insert(User, { name: "B", email: "b@x", age: 20 });
    await new Promise((r) => setTimeout(r, 0));
    await orm.settle();
    await q;
    expect(q.value[0]!.n).toBe(2);
    q.dispose();
  });

  it("preserves row identity when a single column value changes", async () => {
    const a = await orm.insert(User, { name: "A", email: "a@x", age: 10 });
    const b = await orm.insert(User, { name: "B", email: "b@x", age: 20 });
    await orm.insert(User, { name: "C", email: "c@x", age: 30 });

    const q = orm.sqlQuery<{ id: number; name: string; age: number }>(
      'SELECT id, name, age FROM "users" ORDER BY id',
      [],
      { keyBy: (r) => r.id },
    );
    await q;
    const before = [q.value[0], q.value[1], q.value[2]];

    // Change only B.age. A and C must stay === (row identity) and
    // their leaf properties unchanged. B's `.age` must update in
    // place — same object reference, new value.
    await orm.update(b, { age: 99 });
    await new Promise((r) => setTimeout(r, 0));
    await orm.settle();
    await q;

    expect(q.value[0]).toBe(before[0]); // A — unchanged ref
    expect(q.value[1]).toBe(before[1]); // B — mutated in place
    expect(q.value[2]).toBe(before[2]); // C — unchanged ref
    expect(q.value[1]!.age).toBe(99);
    // And A / C's ages didn't get touched:
    expect(q.value[0]!.id).toBe(a.id);
    expect(q.value[0]!.age).toBe(10);

    q.dispose();
  });

  it("only fires reactions on columns that actually changed", async () => {
    const a = await orm.insert(User, { name: "A", email: "a@x", age: 10 });
    const b = await orm.insert(User, { name: "B", email: "b@x", age: 20 });
    const c = await orm.insert(User, { name: "C", email: "c@x", age: 30 });

    const q = orm.sqlQuery<{ id: number; name: string; age: number }>(
      'SELECT id, name, age FROM "users" ORDER BY id',
      [],
      { keyBy: (r) => r.id },
    );
    await q;

    const byId = new Map<number, (typeof q.value)[number]>();
    for (const row of q.value) byId.set(row.id as number, row);

    // Install one reaction per row.age — track which ones fire.
    const fired = new Set<number>();
    const disposers = [a.id, b.id, c.id].map((id) =>
      reaction(
        () => byId.get(id)!.age,
        () => fired.add(id),
      ),
    );

    await orm.update(b, { age: 99 });
    await new Promise((r) => setTimeout(r, 0));
    await orm.settle();
    await q;

    disposers.forEach((d) => d());
    expect([...fired]).toEqual([b.id]); // only B's .age reaction fired
    q.dispose();
  });

  it("inserts + removals reflow the array", async () => {
    const a = await orm.insert(User, { name: "A", email: "a@x", age: 10 });
    const b = await orm.insert(User, { name: "B", email: "b@x", age: 20 });
    const q = orm.sqlQuery<{ id: number }>('SELECT id FROM "users" ORDER BY id', [], {
      keyBy: (r) => r.id,
    });
    await q;
    expect(q.value.length).toBe(2);

    const c = await orm.insert(User, { name: "C", email: "c@x", age: 30 });
    await new Promise((r) => setTimeout(r, 0));
    await orm.settle();
    await q;
    expect(q.value.map((r) => r.id)).toEqual([a.id, b.id, c.id]);

    await orm.delete(b);
    await new Promise((r) => setTimeout(r, 0));
    await orm.settle();
    await q;
    expect(q.value.map((r) => r.id)).toEqual([a.id, c.id]);
    q.dispose();
  });

  it("caches queries so inline re-creation is stable", async () => {
    await orm.insert(User, { name: "A", email: "a@x", age: 1 });
    const q1 = orm.sqlQuery<{ n: number }>('SELECT COUNT(*) AS n FROM "users"');
    const q2 = orm.sqlQuery<{ n: number }>('SELECT COUNT(*) AS n FROM "users"');
    expect(q1).toBe(q2); // same Query instance
    q1.dispose();
  });
});
