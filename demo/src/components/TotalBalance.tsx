import { observer } from "mobx-react-lite";
import { use } from "react";
import { formatMoney } from "@/lib/utils";
import type { AppState } from "@/db/state";

/**
 * Summed balance across all accounts. The component is a two-liner: it
 * reads every account's initial balance and every transaction's amount.
 * Reactivity flows automatically — any insert, update, or delete
 * anywhere recomputes this number.
 */
export const TotalBalance = observer(function TotalBalance({
  state,
}: {
  state: AppState;
}) {
  const accounts = state.accounts.result ?? use(state.accounts.promise);
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
