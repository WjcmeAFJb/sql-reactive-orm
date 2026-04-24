# Getting started

sql-reactive-orm is a MobX-based ORM for SQLite. Entity fields and
relations are `Promise`-typed; rendering in React is as simple as
`use(tx.amount)`.

## Install

```bash
pnpm add 'https://github.com/WjcmeAFJb/sql-reactive-orm/releases/download/v0.1.0/sql-reactive-orm-0.1.0.tgz'
pnpm add sql.js kysely react react-dom
```

The package ships as TypeScript source. Any bundler or Node runner
that handles `.ts` works — Vite, esbuild, Bun, `node
--experimental-strip-types` (Node ≥ 22.6), `tsx`.

## Pick React 19

The happy path uses React 19's [`use()`](https://react.dev/reference/react/use)
hook. Queries are `PromiseLike`, so they drop straight into `use()` and
Suspense. On React 18.3 you can still use the ORM via `mobx-react-lite`'s
`observer` — see the React-18 snippet in the [README](https://github.com/WjcmeAFJb/sql-reactive-orm#react-19-use-vs-react-18).

## Next

- [Quickstart](/guide/quickstart) — a complete money-tracker example.
- [Reactivity model](/concepts/reactivity) — how promises become
  observables.
- [Integration with sql-git](/guide/sql-git) — using the ORM against a
  distributed Store.
