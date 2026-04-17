import { observer } from "mobx-react-lite";
import { use } from "react";
import { formatMoney } from "@/lib/utils";
import { Account } from "@/db/entities";
import { useOrm } from "@/db/orm-context";

/**
 * Summed balance across all accounts. Ten lines. No reducer, no
 * selector, no manual memoization — MobX re-renders this component
 * whenever any of the fields it reads moves, nothing else.
 */
export const TotalBalance = observer(function TotalBalance() {
  const orm = useOrm();
  const accounts = use(
    orm.findAll(Account, { orderBy: "id", with: { transactions: true } }),
  );
  let total = 0;
  for (const a of accounts) {
    total += use(a.initialBalance) as number;
    for (const t of use(a.transactions)) total += use(t.amount) as number;
  }
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        Net worth
      </span>
      <span className="text-3xl font-semibold tabular-nums">
        {formatMoney(total)}
      </span>
    </div>
  );
});
