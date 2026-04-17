import { orm } from "@/db/orm";
import { use } from "react";
import { formatMoney } from "@/lib/utils";
import { Account } from "@/db/entities";

/**
 * Summed balance across all accounts. Reads every account's initial
 * balance and every transaction's amount; the auto-observer Babel
 * plugin wraps this so any of those changes re-renders exactly this
 * number.
 */
export function TotalBalance() {
  const accounts = use(orm.findAll(Account, { orderBy: "id", with: { transactions: true } }));
  let total = 0;
  for (const a of accounts) {
    total += use(a.initialBalance) as number;
    for (const t of use(a.transactions)) total += use(t.amount) as number;
  }
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">Net worth</span>
      <span className="text-3xl font-semibold tabular-nums">{formatMoney(total)}</span>
    </div>
  );
}
