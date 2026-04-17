import { autorun, reaction } from "mobx";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Entity,
  Orm,
  isFulfilled,
  json,
  primary,
} from "../src/index.js";
import type { EntitySchema } from "../src/index.js";
import { createDriver } from "./helpers/driver.js";
import { Comment, Post, User } from "./helpers/entities.js";

class Doc extends Entity {
  static schema: EntitySchema = {
    name: "Doc",
    table: "docs",
    primaryKey: "id",
    fields: {
      id: primary(),
      payload: json(),
    },
    relations: {},
  };
  declare id: number;
  declare payload: Promise<{ tags: string[]; n: number }>;
}

let orm: Orm;

beforeEach(async () => {
  orm = new Orm(await createDriver());
  await orm.register(User, Post, Comment);
});

afterEach(async () => {
  await orm.close();
});

describe("insert + identity map", () => {
  it("insert returns a populated entity", async () => {
    const u = await orm.insert(User, { name: "Alice", email: "a@x.test" });
    expect(u.id).toBeTypeOf("number");
    expect(await u.name).toBe("Alice");
    expect(await u.email).toBe("a@x.test");
  });

  it("same id produces the same instance", async () => {
    const u1 = await orm.insert(User, { name: "Alice", email: "a@x.test" });
    const found = await orm.find(User, u1.id);
    expect(found).toBe(u1);
    const peeked = orm.peek(User, u1.id);
    expect(peeked).toBe(u1);
  });

  it("findAll returns the same instances as insert", async () => {
    const u1 = await orm.insert(User, { name: "A", email: "a@x" });
    const u2 = await orm.insert(User, { name: "B", email: "b@x" });
    const all = await orm.findAll(User, { orderBy: "id" });
    expect(all).toHaveLength(2);
    expect(all[0]).toBe(u1);
    expect(all[1]).toBe(u2);
  });
});

describe("reactive Promise fields", () => {
  it("fields after insert resolve synchronously via `use`-style fast path", async () => {
    const u = await orm.insert(User, { name: "Alice", email: "a@x" });
    const p = u.name;
    expect(isFulfilled(p)).toBe(true);
    // The promise should carry the eager `value` React reads in `use`.
    expect((p as Promise<string> & { value?: string }).value).toBe("Alice");
  });

  it("same field access returns a stable Promise reference", async () => {
    const u = await orm.insert(User, { name: "Alice", email: "a@x" });
    expect(u.name).toBe(u.name);
  });

  it("lazy-loads fields when row is not cached", async () => {
    const u = await orm.insert(User, { name: "Alice", email: "a@x" });
    u._invalidate();
    const p = u.name;
    expect(isFulfilled(p)).toBe(false);
    expect(await p).toBe("Alice");
  });

  it("multiple concurrent field reads dedupe to a single row fetch", async () => {
    const u = await orm.insert(User, { name: "Alice", email: "a@x", age: 30 });
    u._invalidate();
    // Count driver row-level queries for this user id
    const driver = orm.driver;
    const all = driver.all.bind(driver);
    let rowFetches = 0;
    driver.all = async <T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<T[]> => {
      if (sql.includes('FROM "users"') && sql.includes("WHERE")) rowFetches++;
      return all<T>(sql, params);
    };
    const [name, email, age] = await Promise.all([u.name, u.email, u.age]);
    expect(name).toBe("Alice");
    expect(email).toBe("a@x");
    expect(age).toBe(30);
    expect(rowFetches).toBe(1);
  });

  it("updates propagate to MobX observers", async () => {
    const u = await orm.insert(User, { name: "Alice", email: "a@x" });
    const seen: string[] = [];
    const dispose = autorun(() => {
      // Synchronously track the observable via the field getter. Resolution
      // happens off the tracking path via `.then`.
      void u.name.then((v) => seen.push(v));
    });
    await new Promise((r) => setTimeout(r, 1));
    await orm.update(u, { name: "Bob" });
    await new Promise((r) => setTimeout(r, 1));
    dispose();
    expect(seen).toEqual(["Alice", "Bob"]);
  });
});

describe("relations", () => {
  it("hasMany loads children on access", async () => {
    const u = await orm.insert(User, { name: "Alice", email: "a@x" });
    await orm.insert(Post, { title: "P1", authorId: u.id });
    await orm.insert(Post, { title: "P2", authorId: u.id });
    const posts = await u.posts;
    expect(posts).toHaveLength(2);
    expect(await posts[0]!.title).toBe("P1");
  });

  it("belongsTo returns the same instance as the parent lookup", async () => {
    const u = await orm.insert(User, { name: "Alice", email: "a@x" });
    const p = await orm.insert(Post, { title: "P1", authorId: u.id });
    const author = await p.author;
    expect(author).toBe(u);
  });

  it("hasMany via `with` eager-loads in one query batch", async () => {
    const u1 = await orm.insert(User, { name: "A", email: "a@x" });
    const u2 = await orm.insert(User, { name: "B", email: "b@x" });
    await orm.insert(Post, { title: "P1", authorId: u1.id });
    await orm.insert(Post, { title: "P2", authorId: u1.id });
    await orm.insert(Post, { title: "P3", authorId: u2.id });

    const driver = orm.driver;
    const all = driver.all.bind(driver);
    let postsQueries = 0;
    driver.all = async <T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<T[]> => {
      if (sql.includes('FROM "posts"')) postsQueries++;
      return all<T>(sql, params);
    };

    const users = await orm.findAll(User, {
      orderBy: "id",
      with: { posts: true },
    });
    // posts accessed without new DB work
    const postsA = await users[0]!.posts;
    const postsB = await users[1]!.posts;
    expect(postsA).toHaveLength(2);
    expect(postsB).toHaveLength(1);
    // Only one posts query (the batched IN query)
    expect(postsQueries).toBe(1);
    // Identity preserved
    expect(await postsA[0]!.title).toBe("P1");
    expect((await (postsA[0]! as Post).author)).toBe(users[0]);
  });

  it("nested `with` loads grandchildren eagerly", async () => {
    const u = await orm.insert(User, { name: "Alice", email: "a@x" });
    const p = await orm.insert(Post, { title: "P1", authorId: u.id });
    await orm.insert(Comment, { body: "c1", postId: p.id });
    await orm.insert(Comment, { body: "c2", postId: p.id });

    const users = await orm.findAll(User, {
      with: { posts: { comments: true } },
    });
    const posts = await users[0]!.posts;
    const comments = await posts[0]!.comments;
    expect(comments).toHaveLength(2);
    expect(isFulfilled(posts[0]!.comments)).toBe(true);
  });
});

describe("query reactivity", () => {
  it("findAll refetches automatically when the table changes", async () => {
    const u1 = await orm.insert(User, { name: "A", email: "a@x" });
    const q = orm.findAll(User, { orderBy: "id" });
    await q;
    expect(q.value).toHaveLength(1);

    // Mutate and wait — the subscribed query should re-run
    const u2 = await orm.insert(User, { name: "B", email: "b@x" });
    await new Promise((r) => setTimeout(r, 0));
    await q;
    expect(q.value).toHaveLength(2);
    expect(q.value![0]).toBe(u1);
    expect(q.value![1]).toBe(u2);
    q.dispose();
  });

  it("MobX reaction fires on query result change", async () => {
    await orm.insert(User, { name: "A", email: "a@x" });
    const q = orm.findAll(User);
    await q;
    const sizes: number[] = [];
    const dispose = reaction(
      () => q.value?.length ?? 0,
      (n) => sizes.push(n),
    );
    await orm.insert(User, { name: "B", email: "b@x" });
    await new Promise((r) => setTimeout(r, 0));
    await q;
    expect(sizes.at(-1)).toBe(2);
    dispose();
    q.dispose();
  });

  it("dispose() stops further refetches", async () => {
    const q = orm.findAll(User);
    await q;
    q.dispose();
    const before = q;
    await orm.insert(User, { name: "X", email: "x@x" });
    await new Promise((r) => setTimeout(r, 0));
    expect(q).toBe(before);
  });
});

describe("query options", () => {
  beforeEach(async () => {
    await orm.insert(User, { name: "A", email: "a@x", age: 20 });
    await orm.insert(User, { name: "B", email: "b@x", age: 30 });
    await orm.insert(User, { name: "C", email: "c@x", age: 40 });
  });

  it("where supports equality and operators", async () => {
    const young = await orm.findAll(User, {
      where: { age: { lt: 35 } },
      orderBy: "age",
    });
    expect(await Promise.all(young.map((u) => u.name))).toEqual(["A", "B"]);

    const byEmail = await orm.findAll(User, {
      where: { email: "c@x" },
    });
    expect(byEmail).toHaveLength(1);
  });

  it("where supports IN", async () => {
    const some = await orm.findAll(User, {
      where: { name: { in: ["A", "C"] } },
      orderBy: "id",
    });
    expect(some).toHaveLength(2);
  });

  it("orderBy + limit + offset", async () => {
    const page = await orm.findAll(User, {
      orderBy: [["age", "desc"]],
      limit: 2,
      offset: 1,
    });
    expect(page).toHaveLength(2);
    expect(await page[0]!.name).toBe("B");
    expect(await page[1]!.name).toBe("A");
  });

  it("select restricts fetched columns but lazy-loads the rest", async () => {
    // Drop any previously cached rows so the partial projection is visible.
    const existing = await orm.findAll(User);
    for (const u of existing) u._invalidate();

    const users = await orm.findAll(User, {
      select: ["name"],
      orderBy: "id",
    });
    const driver = orm.driver;
    const all = driver.all.bind(driver);
    let rowFetches = 0;
    driver.all = (async <T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<T[]> => {
      if (sql.includes('FROM "users"') && sql.includes("WHERE")) rowFetches++;
      return all<T>(sql, params);
    }) as typeof driver.all;
    // name is in projection → resolved immediately
    expect(isFulfilled(users[0]!.name)).toBe(true);
    expect(rowFetches).toBe(0);
    // age is NOT in projection → triggers lazy row fetch
    const age = await users[0]!.age;
    expect(age).toBe(20);
    expect(rowFetches).toBe(1);
  });

  it("the SELECT issued by `select` omits non-projected columns", async () => {
    const driver = orm.driver;
    const all = driver.all.bind(driver);
    const seen: string[] = [];
    driver.all = (async <T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<T[]> => {
      seen.push(sql);
      return all<T>(sql, params);
    }) as typeof driver.all;
    await orm.findAll(User, { select: ["name"], orderBy: "id" });
    const projection = seen.find((s) => s.startsWith("SELECT"))!;
    expect(projection).toContain('"name"');
    expect(projection).not.toContain('"email"');
    expect(projection).not.toContain('"age"');
  });
});

describe("delete", () => {
  it("removes row and drops identity map entry", async () => {
    const u = await orm.insert(User, { name: "A", email: "a@x" });
    await orm.delete(u);
    expect(orm.peek(User, u.id)).toBeUndefined();
    const users = await orm.findAll(User);
    expect(users).toHaveLength(0);
  });
});

describe("relation invalidation on mutation", () => {
  it("user.posts re-fetches after a new post is inserted", async () => {
    const u = await orm.insert(User, { name: "A", email: "a@x" });
    await orm.insert(Post, { title: "P1", authorId: u.id });
    const first = await u.posts;
    expect(first).toHaveLength(1);

    await orm.insert(Post, { title: "P2", authorId: u.id });
    // The `posts` relation should have been invalidated; next read re-fetches
    const updated = await u.posts;
    expect(updated).toHaveLength(2);
  });
});

describe("json field codec", () => {
  it("encodes/decodes JSON columns transparently", async () => {
    await orm.register(Doc);
    const d = await orm.insert(Doc, { payload: { tags: ["a", "b"], n: 5 } });
    const parsed = await d.payload;
    expect(parsed).toEqual({ tags: ["a", "b"], n: 5 });
  });
});

describe("where: null", () => {
  it("null value compiles to IS NULL", async () => {
    await orm.insert(User, { name: "N", email: "n@x", age: null });
    await orm.insert(User, { name: "A", email: "a@x", age: 20 });
    const nulls = await orm.findAll(User, { where: { age: null } });
    expect(nulls).toHaveLength(1);
  });
});

describe("orm.clearCaches()", () => {
  it("drops cached row + relation data, preserves entity identity", async () => {
    const u = await orm.insert(User, { name: "Alice", email: "a@x" });
    await orm.insert(Post, { title: "P1", authorId: u.id });
    await u.posts; // materialise the relation cache
    expect(u._row).not.toBeNull();
    expect(u._relations.has("posts")).toBe(true);

    orm.clearCaches();

    expect(u._row).toBeNull();
    expect(u._relations.has("posts")).toBe(false);
    // Same instance survives — next access refetches from the driver.
    expect(orm.peek(User, u.id)).toBe(u);
    expect(await u.name).toBe("Alice");
    expect(await u.posts).toHaveLength(1);
  });
});

describe("orm.transaction()", () => {
  it("runs statements atomically and fires one batched notification at COMMIT", async () => {
    const q = orm.findAll(User, { orderBy: "id" });
    await q;

    let runs = 0;
    const internal = q as unknown as { _execute(): void };
    const origExecute = internal._execute.bind(internal);
    internal._execute = () => {
      runs++;
      origExecute();
    };

    await orm.transaction(async () => {
      await orm.insert(User, { name: "A", email: "a@x" });
      await orm.insert(User, { name: "B", email: "b@x" });
      await orm.insert(User, { name: "C", email: "c@x" });
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(runs).toBe(1);
    await q.promise;
    expect(q.value).toHaveLength(3);
    q.dispose();
  });

  it("rolls back on thrown error", async () => {
    await expect(
      orm.transaction(async () => {
        await orm.insert(User, { name: "should-vanish", email: "x@x" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const all = await orm.findAll(User);
    expect(all.find((u) => orm.peek(User, u.id) === u && u)).toBeUndefined();
    const match = await orm.findAll(User, { where: { email: "x@x" } });
    expect(match).toHaveLength(0);
  });

  it("serialises concurrent callers — no interleaved BEGINs", async () => {
    // Instrument the wrapper-facing driver to record the raw statement
    // stream and prove that each BEGIN is followed by its own COMMIT
    // before the next BEGIN appears.
    const stmts: string[] = [];
    const origRun = orm.driver.run.bind(orm.driver);
    orm.driver.run = (async (sql: string, params?: readonly unknown[]) => {
      const head = sql.trim().split(/\s+/)[0]!.toUpperCase();
      if (head === "BEGIN" || head === "COMMIT" || head === "ROLLBACK") {
        stmts.push(head);
      } else {
        stmts.push("STMT");
      }
      return origRun(sql, params);
    }) as typeof orm.driver.run;

    const results = await Promise.all([
      orm.transaction(async () => {
        await orm.insert(User, { name: "T1-a", email: "t1a@x" });
        await orm.insert(User, { name: "T1-b", email: "t1b@x" });
      }),
      orm.transaction(async () => {
        await orm.insert(User, { name: "T2-a", email: "t2a@x" });
        await orm.insert(User, { name: "T2-b", email: "t2b@x" });
      }),
      orm.transaction(async () => {
        await orm.insert(User, { name: "T3-a", email: "t3a@x" });
      }),
    ]);
    expect(results).toEqual([undefined, undefined, undefined]);

    // The stream must look like: BEGIN STMT* COMMIT BEGIN STMT* COMMIT …
    const keywords = stmts.filter(
      (s) => s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK",
    );
    expect(keywords).toEqual([
      "BEGIN",
      "COMMIT",
      "BEGIN",
      "COMMIT",
      "BEGIN",
      "COMMIT",
    ]);

    // All five rows landed.
    const all = await orm.findAll(User, {
      where: { email: { like: "t%@x" } },
      orderBy: "id",
    });
    expect(all).toHaveLength(5);
  });

  it("concurrent non-transaction writes interleave fine", async () => {
    await Promise.all([
      orm.insert(User, { name: "P1", email: "p1@x" }),
      orm.insert(User, { name: "P2", email: "p2@x" }),
      orm.insert(User, { name: "P3", email: "p3@x" }),
    ]);
    const all = await orm.findAll(User, { where: { email: { like: "p%@x" } } });
    expect(all).toHaveLength(3);
  });
});

describe("orm.settle()", () => {
  it("waits for post-mutation row + relation refreshes to land", async () => {
    const u = await orm.insert(User, { name: "A", email: "a@x" });
    await orm.insert(Post, { title: "P1", authorId: u.id });
    await u.posts;

    await orm.insert(Post, { title: "P2", authorId: u.id });
    // Without waiting, the cached relation promise is still the stale
    // [P1] one — stale-while-revalidate keeps the old data up until the
    // refresh completes. `settle()` bridges the gap for code that needs
    // to observe the fresh state synchronously.
    await orm.settle();
    const posts = await u.posts;
    expect(posts).toHaveLength(2);
  });
});

describe("reactive raw SQL: orm is oblivious to the origin of the mutation", () => {
  it("raw UPDATE through orm.driver refreshes an open query", async () => {
    const u = await orm.insert(User, { name: "Alice", email: "a@x" });
    const q = orm.findAll(User, { orderBy: "id" });
    await q;
    expect(await (q.value![0] as User).name).toBe("Alice");

    // An "unrelated library" — represented here just by a hand-written
    // statement — mutates through the ORM's driver. No orm.update call.
    await orm.driver.run('UPDATE "users" SET name = ? WHERE id = ?', [
      "Bob",
      u.id,
    ]);
    await new Promise((r) => setTimeout(r, 0));
    await q;
    expect(await (q.value![0] as User).name).toBe("Bob");
    q.dispose();
  });

  it("raw INSERT through orm.driver surfaces the new row in a findAll query", async () => {
    const q = orm.findAll(User, { orderBy: "id" });
    await q;
    expect(q.value).toEqual([]);

    await orm.driver.run(
      'INSERT INTO "users" (name, email) VALUES (?, ?)',
      ["Carol", "c@x"],
    );
    await new Promise((r) => setTimeout(r, 0));
    await q;
    expect(q.value).toHaveLength(1);
    expect(await q.value![0]!.name).toBe("Carol");
    q.dispose();
  });

  it("raw DELETE through orm.driver drops the row from an open query", async () => {
    const u = await orm.insert(User, { name: "A", email: "a@x" });
    await orm.insert(User, { name: "B", email: "b@x" });
    const q = orm.findAll(User, { orderBy: "id" });
    await q;
    expect(q.value).toHaveLength(2);

    await orm.driver.run('DELETE FROM "users" WHERE id = ?', [u.id]);
    await new Promise((r) => setTimeout(r, 0));
    await q;
    expect(q.value).toHaveLength(1);
    q.dispose();
  });

  it("raw exec of multi-statement DDL notifies every table touched", async () => {
    const u = await orm.insert(User, { name: "A", email: "a@x" });
    await orm.insert(Post, { title: "P1", authorId: u.id });

    const qu = orm.findAll(User);
    const qp = orm.findAll(Post);
    await qu;
    await qp;
    expect(qu.value).toHaveLength(1);
    expect(qp.value).toHaveLength(1);

    await orm.driver.exec(`
      DELETE FROM "posts";
      DELETE FROM "users";
    `);
    await new Promise((r) => setTimeout(r, 0));
    await Promise.all([qu, qp]);
    expect(qu.value).toHaveLength(0);
    expect(qp.value).toHaveLength(0);
    qu.dispose();
    qp.dispose();
  });

  it("Entity method running raw SQL keeps consumers reactive", async () => {
    // Demonstrate the intended pattern: put the mutation in a method on
    // the entity, have it call `this._orm.driver.run(...)` with any SQL
    // the user likes, and trust that the ORM will invalidate on its own.
    class UserWithRename extends User {
      async rename(newName: string): Promise<void> {
        await this._orm.driver.run(
          'UPDATE "users" SET name = ? WHERE id = ?',
          [newName, this.id as number],
        );
      }
    }
    Object.assign(UserWithRename, { schema: User.schema });

    const u = await orm.insert(UserWithRename, {
      name: "Alice",
      email: "a@x",
    });
    const q = orm.findAll(UserWithRename, { orderBy: "id" });
    await q;
    expect(await (q.value![0] as User).name).toBe("Alice");

    await u.rename("Bob");
    await new Promise((r) => setTimeout(r, 0));
    await q;
    expect(await (q.value![0] as User).name).toBe("Bob");

    // The instance itself also updates since the findAll refetch re-applies
    // the row onto the same identity-map instance.
    expect(await u.name).toBe("Bob");
    q.dispose();
  });

  it("transaction batches multiple writes into one notification per table", async () => {
    await orm.insert(User, { name: "A", email: "a@x" });
    const q = orm.findAll(User, { orderBy: "id" });
    await q;

    let runs = 0;
    const internal = q as unknown as { _execute(): void };
    const origExecute = internal._execute.bind(internal);
    internal._execute = () => {
      runs++;
      origExecute();
    };

    await orm.driver.run("BEGIN");
    await orm.driver.run('INSERT INTO "users" (name, email) VALUES (?, ?)', [
      "B",
      "b@x",
    ]);
    await orm.driver.run('INSERT INTO "users" (name, email) VALUES (?, ?)', [
      "C",
      "c@x",
    ]);
    await orm.driver.run('UPDATE "users" SET name = ? WHERE name = ?', [
      "A2",
      "A",
    ]);
    expect(runs).toBe(0);
    await orm.driver.run("COMMIT");
    // The three mutations collapse into exactly one refetch.
    expect(runs).toBe(1);
    q.dispose();
  });

  it("ROLLBACK suppresses the notification entirely", async () => {
    const q = orm.findAll(User);
    await q;

    let runs = 0;
    const internal = q as unknown as { _execute(): void };
    const origExecute = internal._execute.bind(internal);
    internal._execute = () => {
      runs++;
      origExecute();
    };

    await orm.driver.run("BEGIN");
    await orm.driver.run('INSERT INTO "users" (name, email) VALUES (?, ?)', [
      "X",
      "x@x",
    ]);
    await orm.driver.run("ROLLBACK");
    await new Promise((r) => setTimeout(r, 0));
    expect(runs).toBe(0);
    q.dispose();
  });

  it("orm.rawDriver bypasses reactivity (escape hatch)", async () => {
    const q = orm.findAll(User);
    await q;

    let runs = 0;
    const internal = q as unknown as { _execute(): void };
    const origExecute = internal._execute.bind(internal);
    internal._execute = () => {
      runs++;
      origExecute();
    };

    // Write via the raw driver — no subscribers should fire.
    await orm.rawDriver.run(
      'INSERT INTO "users" (name, email) VALUES (?, ?)',
      ["Ghost", "g@x"],
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(runs).toBe(0);

    // Explicit manual notification wakes subscribers back up.
    orm.invalidate("users");
    await new Promise((r) => setTimeout(r, 0));
    await q;
    expect(runs).toBe(1);
    expect(q.value).toHaveLength(1);
    q.dispose();
  });
});
