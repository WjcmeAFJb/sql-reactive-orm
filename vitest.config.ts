import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = dirname(fileURLToPath(import.meta.url));

// Make the sql.js wasm reachable as `/sql-wasm.wasm` during browser tests.
const wasmSrc = require.resolve("sql.js/dist/sql-wasm.wasm");
const publicDir = resolve(projectRoot, "public");
const wasmDst = resolve(publicDir, "sql-wasm.wasm");
if (!existsSync(wasmDst)) {
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(wasmSrc, wasmDst);
}

export default defineConfig({
  publicDir,
  esbuild: {
    jsx: "automatic",
  },
  optimizeDeps: {
    include: [
      "sql.js",
      "react",
      "react-dom",
      "react-dom/client",
      "mobx",
      "mobx-react-lite",
      "vitest-browser-react",
      "@testing-library/react",
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["test/**/*.test.ts"],
          exclude: ["test/**/*.browser.test.*", "node_modules/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: ["test/**/*.browser.test.tsx"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
