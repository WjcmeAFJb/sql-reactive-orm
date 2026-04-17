import { observer } from "mobx-react-lite";
import { use } from "react";
import { Pencil } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, formatMoney } from "@/lib/utils";
import { Account } from "@/db/entities";
import { ui } from "@/ui/ui-state";

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
    <Card className="group relative overflow-hidden">
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
          <div className="text-xs text-muted-foreground">{txs.length} tx</div>
        </div>
      </CardContent>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => ui.openEditAccount(account)}
        aria-label={`Edit ${name}`}
        className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <Pencil className="size-4" />
      </Button>
    </Card>
  );
});
