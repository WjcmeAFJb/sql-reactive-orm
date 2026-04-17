import { observer } from "mobx-react-lite";
import { use } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn, formatMoney } from "@/lib/utils";
import { Account } from "@/db/entities";

/**
 * An account card. Balance = initialBalance + Σ amounts. Because the
 * component is wrapped in `observer` and reads observable fields off the
 * ORM entities, the balance *literally* recomputes when any related
 * transaction is added, updated, or deleted — from anywhere in the app.
 * No subscription plumbing, no selectors, no memoization.
 */
export const AccountCard = observer(function AccountCard({
  account,
}: {
  account: Account;
}) {
  const name = use(account.name);
  const color = use(account.color);
  const initial = use(account.initialBalance);
  const txs = use(account.transactions);
  const balance = txs.reduce(
    (sum, t) => sum + (use(t.amount) as number),
    initial,
  );

  return (
    <Card className="overflow-hidden">
      <div className="h-1" style={{ backgroundColor: color }} />
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {name}
            </div>
            <div
              className={cn(
                "mt-1 text-2xl font-semibold tabular-nums",
                balance < 0 && "text-destructive",
              )}
            >
              {formatMoney(balance)}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {txs.length} tx
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
