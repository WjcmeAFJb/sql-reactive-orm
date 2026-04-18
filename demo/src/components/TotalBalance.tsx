import { use } from "react";
import { sql } from "kysely";
import { orm } from "@/db/orm";
import { formatMoney } from "@/lib/utils";

/**
 * One scalar SQL: sum of every account's `initialBalance` + every
 * transaction's `amount`. The reactive driver sees the query touches
 * `accounts` and `transactions`; any mutation to either refetches and
 * diffs — if the scalar didn't move, the row reference is preserved
 * and this component skips rendering.
 */
export function TotalBalance() {
  const [row] = use(
    orm.sqlQuery((db) =>
      db.selectNoFrom(
        sql<number>`
          COALESCE((SELECT SUM(initialBalance) FROM accounts), 0)
          + COALESCE((SELECT SUM(amount) FROM transactions), 0)
        `.as("total"),
      ),
    ),
  );
  const total = row?.total ?? 0;

  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">Net worth</span>
      <span className="text-3xl font-semibold tabular-nums">{formatMoney(total)}</span>
    </div>
  );
}
