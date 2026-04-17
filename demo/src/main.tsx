import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<BootFallback />}>
      <App />
    </Suspense>
  </React.StrictMode>,
);

function BootFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
      Warming up SQLite…
    </div>
  );
}
