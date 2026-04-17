import { describe, expect, it } from "vitest";
import { detectMutatedTables, wrapReactive } from "../src/index.js";
import type { Driver } from "../src/index.js";

describe("detectMutatedTables", () => {
  it("parses INSERT / UPDATE / DELETE / REPLACE with unquoted names", () => {
    expect([...detectMutatedTables("INSERT INTO users VALUES (1)")]).toEqual(["users"]);
    expect([...detectMutatedTables("UPDATE users SET name = 'x'")]).toEqual(["users"]);
    expect([...detectMutatedTables("DELETE FROM users WHERE id = 1")]).toEqual(["users"]);
    expect([...detectMutatedTables("REPLACE INTO users VALUES (1)")]).toEqual(["users"]);
  });

  it("handles SQLite double-quoted, MySQL backtick, and SQL Server bracket identifiers", () => {
    expect([...detectMutatedTables('INSERT INTO "users" VALUES (1)')]).toEqual(["users"]);
    expect([...detectMutatedTables("INSERT INTO `users` VALUES (1)")]).toEqual(["users"]);
    expect([...detectMutatedTables("INSERT INTO [users] VALUES (1)")]).toEqual(["users"]);
  });

  it("handles INSERT OR REPLACE / OR IGNORE etc.", () => {
    expect([...detectMutatedTables("INSERT OR REPLACE INTO users VALUES (1)")]).toEqual(["users"]);
    expect([...detectMutatedTables("UPDATE OR IGNORE users SET name = 'x'")]).toEqual(["users"]);
  });

  it("handles DROP / ALTER TABLE", () => {
    expect([...detectMutatedTables("DROP TABLE users")]).toEqual(["users"]);
    expect([...detectMutatedTables("DROP TABLE IF EXISTS users")]).toEqual(["users"]);
    expect([...detectMutatedTables("ALTER TABLE users ADD COLUMN x INTEGER")]).toEqual(["users"]);
  });

  it("returns empty set for SELECT / pragma / BEGIN", () => {
    expect(detectMutatedTables("SELECT * FROM users").size).toBe(0);
    expect(detectMutatedTables("PRAGMA foreign_keys = on").size).toBe(0);
    expect(detectMutatedTables("BEGIN").size).toBe(0);
    expect(detectMutatedTables("COMMIT").size).toBe(0);
  });

  it("ignores keywords inside string literals and comments (heuristic)", () => {
    // Comments get stripped, so a UPDATE inside a comment does not match.
    expect(detectMutatedTables("SELECT 1 -- UPDATE users SET x = 1").size).toBe(0);
    expect(detectMutatedTables("SELECT 1 /* DELETE FROM users */").size).toBe(0);
  });

  it("finds multiple tables in a multi-statement SQL", () => {
    const sql = `
      INSERT INTO users VALUES (1);
      UPDATE posts SET title = 'x' WHERE id = 1;
      DELETE FROM comments WHERE id = 1;
    `;
    expect([...detectMutatedTables(sql)].sort()).toEqual(["comments", "posts", "users"]);
  });
});

describe("wrapReactive", () => {
  function makeStubDriver(): Driver & { log: string[] } {
    const log: string[] = [];
    return {
      log,
      async exec(sql) {
        log.push(`exec:${sql}`);
      },
      async run(sql) {
        log.push(`run:${sql}`);
        return { changes: 1, lastInsertRowid: 1 };
      },
      async all<T>(sql: string): Promise<T[]> {
        log.push(`all:${sql}`);
        return [] as T[];
      },
    };
  }

  it("passes through SELECT without firing onMutation", async () => {
    const inner = makeStubDriver();
    const fired: Set<string>[] = [];
    const d = wrapReactive(inner, (t) => fired.push(t));
    await d.all("SELECT * FROM users");
    expect(fired).toEqual([]);
  });

  it("fires onMutation after mutating run", async () => {
    const inner = makeStubDriver();
    const fired: Set<string>[] = [];
    const d = wrapReactive(inner, (t) => fired.push(t));
    await d.run("UPDATE users SET name = 'x' WHERE id = 1");
    expect(fired.map((s) => [...s])).toEqual([["users"]]);
  });

  it("fires onMutation after mutating exec", async () => {
    const inner = makeStubDriver();
    const fired: Set<string>[] = [];
    const d = wrapReactive(inner, (t) => fired.push(t));
    await d.exec("INSERT INTO posts VALUES (1)");
    expect(fired.map((s) => [...s])).toEqual([["posts"]]);
  });

  it("fires notification AFTER the underlying statement completes", async () => {
    const order: string[] = [];
    const inner: Driver = {
      async exec() {},
      async run(sql) {
        order.push(`run-start:${sql}`);
        await new Promise((r) => setTimeout(r, 1));
        order.push(`run-end:${sql}`);
        return { changes: 1, lastInsertRowid: 1 };
      },
      async all() {
        return [];
      },
    };
    const d = wrapReactive(inner, () => order.push("notify"));
    await d.run("UPDATE users SET x = 1");
    expect(order).toEqual([
      "run-start:UPDATE users SET x = 1",
      "run-end:UPDATE users SET x = 1",
      "notify",
    ]);
  });

  it("batches mutations in a transaction: one notification per affected table on COMMIT", async () => {
    const inner = makeStubDriver();
    const fired: string[][] = [];
    const d = wrapReactive(inner, (t) => fired.push([...t].sort()));
    await d.run("BEGIN");
    await d.run("INSERT INTO users VALUES (1)");
    await d.run("INSERT INTO users VALUES (2)");
    await d.run("INSERT INTO posts VALUES (1)");
    expect(fired).toEqual([]); // deferred
    await d.run("COMMIT");
    expect(fired).toEqual([["posts", "users"]]);
  });

  it("drops deferred notifications on ROLLBACK", async () => {
    const inner = makeStubDriver();
    const fired: string[][] = [];
    const d = wrapReactive(inner, (t) => fired.push([...t].sort()));
    await d.run("BEGIN");
    await d.run("INSERT INTO users VALUES (1)");
    await d.run("ROLLBACK");
    expect(fired).toEqual([]);
  });

  it("nested savepoints still defer until outermost commit", async () => {
    const inner = makeStubDriver();
    const fired: string[][] = [];
    const d = wrapReactive(inner, (t) => fired.push([...t].sort()));
    await d.run("BEGIN");
    await d.run("INSERT INTO users VALUES (1)");
    await d.run("SAVEPOINT sp1");
    await d.run("UPDATE posts SET title = 'x' WHERE id = 1");
    await d.run("RELEASE sp1");
    expect(fired).toEqual([]);
    await d.run("COMMIT");
    expect(fired).toEqual([["posts", "users"]]);
  });

  it("delegates close() to the inner driver when available", async () => {
    let closed = false;
    const inner: Driver = {
      async exec() {},
      async run() {
        return { changes: 0, lastInsertRowid: 0 };
      },
      async all() {
        return [];
      },
      async close() {
        closed = true;
      },
    };
    const d = wrapReactive(inner, () => {});
    await d.close?.();
    expect(closed).toBe(true);
  });
});
