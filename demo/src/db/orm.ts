import { Orm } from "sql-reactive-orm";
import { SqlJsDriver } from "sql-reactive-orm/drivers/sqljs";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { observable, runInAction } from "mobx";
import type { DB } from "@/generated/db";
import { Account, Category, Transaction } from "./entities";
import { seed } from "./seed";

/**
 * Observable counters surfaced in the UI. The SELECT counter is the
 * interesting one for the "progressive optimisation" demo: switching the
 * query strategy changes the number of round trips dramatically while
 * every component keeps rendering the same way.
 */
export const stats = observable({
  selectCount: 0,
  lastSelect: "",
  mutationCount: 0,
  lastMutation: "",
});

async function init(): Promise<Orm<DB>> {
  const driver = await SqlJsDriver.open({ locateFile: () => wasmUrl });

  // Instrument the *underlying* driver so every call — including those
  // routed through `orm.driver` (the reactive wrapper) — lands here.
  // We update the stats *after* the await so the observable write never
  // happens inside a React render (e.g. when a lazy relation read
  // triggers a SELECT during a component's render pass).
  const origAll = driver.all.bind(driver);
  const origRun = driver.run.bind(driver);
  driver.all = (async (sql: string, params?: readonly unknown[]) => {
    const res = await origAll(sql, params);
    runInAction(() => {
      stats.selectCount++;
      stats.lastSelect = sql;
    });
    return res;
  }) as typeof driver.all;
  driver.run = (async (sql: string, params?: readonly unknown[]) => {
    const res = await origRun(sql, params);
    runInAction(() => {
      stats.mutationCount++;
      stats.lastMutation = sql;
    });
    return res;
  }) as typeof driver.run;

  const orm = new Orm<DB>(driver);
  await orm.register(Account, Category, Transaction);
  await seed(orm);

  // Reset the counters after seed so the user sees only their own clicks
  // in the UI, not the (chatty) seed pass.
  runInAction(() => {
    stats.selectCount = 0;
    stats.mutationCount = 0;
    stats.lastSelect = "";
    stats.lastMutation = "";
  });

  return orm;
}

/**
 * Top-level await: Vite lets us block the module graph on DB init so
 * every downstream import sees a ready-to-use `orm`. No `useOrm()`
 * hook, no `<OrmProvider>`, no `use(ormPromise)` — components just
 * `import { orm }` and go.
 */
export const orm = await init();
