import { use } from "react";
import { Pencil } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, formatMoney } from "@/lib/utils";
import { Account } from "@/db/entities";
import { ui } from "@/ui/ui-state";

export function AccountCard({
  account,
  stats,
}: {
  account: Account;
  /** Row from the account-stats sqlQuery. Undefined briefly for a freshly-inserted account. */
  stats: { balance: number; txCount: number } | undefined;
}) {
  const name = use(account.name);
  const color = use(account.color);
  const balance = stats?.balance ?? 0;
  const txCount = stats?.txCount ?? 0;

  return (
    <Card className="group relative overflow-hidden">
      <div className="h-1" style={{ backgroundColor: color }} />
      <CardContent className="p-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{name}</div>
        <div className="mt-1 flex items-end justify-between gap-2">
          <div
            className={cn("text-2xl font-semibold tabular-nums", balance < 0 && "text-destructive")}
          >
            {formatMoney(balance)}
          </div>
          <div className="pb-1 text-xs text-muted-foreground">{txCount} tx</div>
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
}
