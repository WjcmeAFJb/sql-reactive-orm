import { SqlJsDriver } from "../../src/drivers/sqljs.js";

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

let cachedWasm: ArrayBuffer | null = null;

async function getWasmBinary(): Promise<ArrayBuffer> {
  if (cachedWasm) return cachedWasm;
  if (isBrowser) {
    // Vite serves `public/` at the origin root during tests.
    const res = await fetch("/sql-wasm.wasm");
    if (!res.ok) throw new Error(`Failed to fetch /sql-wasm.wasm: ${res.status} ${res.statusText}`);
    cachedWasm = await res.arrayBuffer();
    return cachedWasm;
  }
  const { readFileSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  const wasmPath = req.resolve("sql.js/dist/sql-wasm.wasm");
  const buf = readFileSync(wasmPath);
  cachedWasm = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return cachedWasm;
}

export async function createDriver(): Promise<SqlJsDriver> {
  const wasmBinary = await getWasmBinary();
  return SqlJsDriver.open({ wasmBinary });
}
