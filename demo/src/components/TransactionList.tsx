import { observer } from "mobx-react-lite";
import { use } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TransactionRow } from "./TransactionRow";
import type { AppState } from "@/db/state";

/**
 * Reactive list: `state.transactions` is a Query; its `.result`
 * observable holds the last-resolved array. When a mutation fires a
 * refetch we *keep rendering the old array* until the new one arrives
 * — so the user never sees a blank suspense fallback on a subsequent
 * mutation.
 */
export const TransactionList = observer(function TransactionList({
  state,
}: {
  state: AppState;
}) {
  // `.result` stays populated through refetches; fall back to `use`
  // (which suspends) only for the very first load.
  const rows = state.transactions.result ?? use(state.transactions.promise);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Transactions</CardTitle>
          <span className="text-xs text-muted-foreground">
            {rows.length} total
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No transactions yet.
          </div>
        ) : (
          <div className="divide-y divide-[--color-border]">
            {rows.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} state={state} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
});
