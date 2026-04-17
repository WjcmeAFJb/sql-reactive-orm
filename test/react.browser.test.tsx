import React, { Suspense, use, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { Orm } from "../src/index.js";
import { createDriver } from "./helpers/driver.js";
import { Post, User } from "./helpers/entities.js";

let orm: Orm;

beforeEach(async () => {
  orm = new Orm(await createDriver());
  await orm.register(User, Post);
});

afterEach(async () => {
  cleanup();
  await orm.close();
});

// ---- components ----

const UserName = observer(function UserName({ user }: { user: User }) {
  const name = use(user.name);
  return <span data-testid={`name-${user.id}`}>{name}</span>;
});

const UserProfile = observer(function UserProfile({ user }: { user: User }) {
  const name = use(user.name);
  const email = use(user.email);
  return (
    <div data-testid={`profile-${user.id}`}>
      name:{name} email:{email}
    </div>
  );
});

const PostTitle = observer(function PostTitle({ post }: { post: Post }) {
  const title = use(post.title);
  return <span data-testid={`post-${post.id}`}>{title}</span>;
});

const UserWithPosts = observer(function UserWithPosts({
  user,
}: {
  user: User;
}) {
  const name = use(user.name);
  const posts = use(user.posts);
  return (
    <div data-testid={`uwp-${user.id}`}>
      <span>user:{name}</span>
      <ul>
        {posts.map((p) => (
          <li key={p.id}>
            <PostTitle post={p} />
          </li>
        ))}
      </ul>
    </div>
  );
});

// ---- tests ----

describe("react: reactive Promise fields + `use`", () => {
  it("renders a resolved field synchronously (no suspense flash)", async () => {
    const u = await orm.insert(User, { name: "Alice", email: "a@x" });
    const screen = await render(
      <Suspense fallback={<span>loading</span>}>
        <UserName user={u} />
      </Suspense>,
    );
    // Row is already loaded, `use` returns sync — no loading indicator.
    await expect
      .element(screen.getByTestId(`name-${u.id}`))
      .toHaveTextContent("Alice");
  });

  it("suspends on lazy field load then renders value", async () => {
    const u = await orm.insert(User, { name: "Alice", email: "a@x" });
    u._invalidate();

    // Slow down the driver so the Suspense fallback is observable.
    const origAll = orm.driver.all.bind(orm.driver);
    orm.driver.all = (async (sql: string, params?: readonly unknown[]) => {
      await new Promise((r) => setTimeout(r, 50));
      return origAll(sql, params);
    }) as typeof orm.driver.all;

    const screen = await render(
      <Suspense fallback={<span data-testid="fallback">loading</span>}>
        <UserName user={u} />
      </Suspense>,
    );
    // Suspense fallback visible first, then the resolved value.
    await expect.element(screen.getByTestId("fallback")).toBeInTheDocument();
    await expect
      .element(screen.getByTestId(`name-${u.id}`))
      .toHaveTextContent("Alice");
  });

  it("re-renders with new value when the entity row is updated", async () => {
    const u = await orm.insert(User, { name: "Alice", email: "a@x" });
    const screen = await render(
      <Suspense fallback={<span>loading</span>}>
        <UserName user={u} />
      </Suspense>,
    );
    await expect
      .element(screen.getByTestId(`name-${u.id}`))
      .toHaveTextContent("Alice");
    await orm.update(u, { name: "Bob" });
    await expect
      .element(screen.getByTestId(`name-${u.id}`))
      .toHaveTextContent("Bob");
  });
});

describe("react: reactive findAll + Suspense", () => {
  const UserList = observer(function UserList() {
    const query = useMemo(() => orm.findAll(User, { orderBy: "id" }), []);
    useEffect(() => () => query.dispose(), [query]);
    const users = use(query.promise);
    return (
      <ul data-testid="list">
        {users.map((u) => (
          <li key={u.id}>
            <UserName user={u} />
          </li>
        ))}
      </ul>
    );
  });

  it("renders the list and reacts to inserts / deletes", async () => {
    await orm.insert(User, { name: "A", email: "a@x" });
    await orm.insert(User, { name: "B", email: "b@x" });

    const screen = await render(
      <Suspense fallback={<span>loading list</span>}>
        <UserList />
      </Suspense>,
    );
    await expect.element(screen.getByText("A")).toBeInTheDocument();
    await expect.element(screen.getByText("B")).toBeInTheDocument();

    // Insert — auto-refetches the query; `use(query.promise)` re-suspends
    // briefly and then settles with the new list.
    await orm.insert(User, { name: "C", email: "c@x" });
    await expect.element(screen.getByText("C")).toBeInTheDocument();

    // Delete: drop user "A".
    const all = await orm.findAll(User, { orderBy: "id" });
    await orm.delete(all[0]!);
    await expect
      .element(screen.getByTestId("list"))
      .not.toHaveTextContent("A");
  });
});

describe("react: waterfall avoidance via `with`", () => {
  it("eager-loaded posts + titles render without N+1 row queries", async () => {
    const u = await orm.insert(User, { name: "Alice", email: "a@x" });
    await orm.insert(Post, { title: "P1", authorId: u.id });
    await orm.insert(Post, { title: "P2", authorId: u.id });
    // Invalidate so the row + relation must come from the eager-loading
    // path, not the identity-map's cached row.
    u._invalidate();

    const driver = orm.driver;
    const origAll = driver.all.bind(driver);
    const queries: string[] = [];
    driver.all = (async <T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<T[]> => {
      queries.push(sql);
      return origAll<T>(sql, params);
    }) as typeof driver.all;

    // Create the query outside the component. When React suspends the
    // subtree, hook state (including useMemo) is re-run on retry, but a
    // module-scoped object stays stable — so we don't issue the query
    // twice from the re-suspension alone.
    const q = orm.findFirst(User, {
      where: { id: u.id },
      with: { posts: true },
    });

    const Runner = observer(function Runner() {
      const loaded = use(q.promise);
      if (!loaded) return <span>none</span>;
      return <UserWithPosts user={loaded} />;
    });

    const screen = await render(
      <Suspense fallback={<span>loading</span>}>
        <Runner />
      </Suspense>,
    );
    await expect
      .element(screen.getByTestId(`uwp-${u.id}`))
      .toContainElement(screen.getByTestId(`post-${1}`).element());
    await expect
      .element(screen.getByTestId(`post-1`))
      .toHaveTextContent("P1");
    await expect
      .element(screen.getByTestId(`post-2`))
      .toHaveTextContent("P2");

    // The key waterfall-avoidance assertion: posts are loaded in a single
    // IN-batch, not once per user. A per-post belongsTo lookup would look
    // like `WHERE "id" = ?` — we shouldn't see any of those for posts.
    const postQueries = queries.filter((s) => s.includes('FROM "posts"'));
    expect(postQueries.length).toBe(1);
    expect(postQueries[0]).toMatch(/IN \(/);
  });
});

describe("react: identity map guarantees stable instances across renders", () => {
  it("two components receive the same instance; both re-render on update", async () => {
    const u = await orm.insert(User, { name: "Alice", email: "a@x" });

    // A second component independently looks up the user via the ORM.
    const OtherLookup = observer(function OtherLookup() {
      const [entity, setEntity] = useState<User | null>(null);
      useEffect(() => {
        const q = orm.findFirst(User, { where: { id: u.id } });
        void q.then((v) => setEntity(v));
        return () => q.dispose();
      }, []);
      if (!entity) return <span>pending</span>;
      return <UserProfile user={entity} />;
    });

    function App() {
      return (
        <Suspense fallback={<span>loading</span>}>
          <UserName user={u} />
          <OtherLookup />
        </Suspense>
      );
    }

    const screen = await render(<App />);
    await expect
      .element(screen.getByTestId(`name-${u.id}`))
      .toHaveTextContent("Alice");
    await expect
      .element(screen.getByTestId(`profile-${u.id}`))
      .toHaveTextContent(/name:Alice/);

    await orm.update(u, { name: "Bob", email: "b@x" });
    await expect
      .element(screen.getByTestId(`name-${u.id}`))
      .toHaveTextContent("Bob");
    await expect
      .element(screen.getByTestId(`profile-${u.id}`))
      .toHaveTextContent(/name:Bob/);
    await expect
      .element(screen.getByTestId(`profile-${u.id}`))
      .toHaveTextContent(/email:b@x/);

    // Still the same identity-map instance.
    const looked = await orm.find(User, u.id);
    expect(looked).toBe(u);
  });
});
