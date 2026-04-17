import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

// `App` and its whole module graph synchronously import `orm` from
// `@/db/orm`, which uses a top-level `await` to open sql.js + seed.
// Vite's ESM module graph blocks here until the DB is ready, so by
// the time this file runs everything downstream is initialised.
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
