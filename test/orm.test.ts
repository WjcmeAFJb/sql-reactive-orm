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
    expect(q.result).toHaveLength(1);

    // Mutate and wait — the subscribed query should re-run
    const u2 = await orm.insert(User, { name: "B", email: "b@x" });
    await new Promise((r) => setTimeout(r, 0));
    await q.promise;
    expect(q.result).toHaveLength(2);
    expect(q.result![0]).toBe(u1);
    expect(q.result![1]).toBe(u2);
    q.dispose();
  });

  it("MobX reaction fires on query result change", async () => {
    await orm.insert(User, { name: "A", email: "a@x" });
    const q = orm.findAll(User);
    await q;
    const sizes: number[] = [];
    const dispose = reaction(
      () => q.result?.length ?? 0,
      (n) => sizes.push(n),
    );
    await orm.insert(User, { name: "B", email: "b@x" });
    await new Promise((r) => setTimeout(r, 0));
    await q.promise;
    expect(sizes.at(-1)).toBe(2);
    dispose();
    q.dispose();
  });

  it("dispose() stops further refetches", async () => {
    const q = orm.findAll(User);
    await q;
    q.dispose();
    const before = q.promise;
    await orm.insert(User, { name: "X", email: "x@x" });
    await new Promise((r) => setTimeout(r, 0));
    expect(q.promise).toBe(before);
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
