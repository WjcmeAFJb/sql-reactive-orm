import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import observerPlugin from "mobx-react-observer/babel-plugin";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react({
      babel: {
        // Auto-wraps every function component in `observer` at build
        // time — so nothing in the app needs an explicit `observer()`
        // call. The shadcn UI primitives don't read MobX state, so we
        // skip them to avoid paying the observer overhead for nothing.
        plugins: [observerPlugin({ exclude: ["src/components/ui/**"] })],
      },
    }),
    tailwind(),
  ],
  resolve: {
    alias: [
      // Point the demo at the in-repo ORM source so edits flow through
      // without a build step. In a real consumer you'd just
      // `pnpm add sql-reactive-orm` and drop this alias.
      { find: /^sql-reactive-orm$/, replacement: resolve(here, "../src/index.ts") },
      { find: /^sql-reactive-orm\/(.+)$/, replacement: resolve(here, "../src/$1.ts") },
      { find: "@", replacement: resolve(here, "src") },
    ],
  },
  optimizeDeps: {
    include: ["sql.js"],
    exclude: ["sql-reactive-orm"],
  },
  build: {
    // Top-level await in `db/orm.ts` needs a target that supports it.
    target: "es2022",
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: [".code.internal.local"],
  },
});
