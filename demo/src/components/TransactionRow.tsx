import { observer } from "mobx-react-lite";
import { use } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { Transaction } from "@/db/entities";
import type { AppState } from "@/db/state";

/**
 * One row per transaction. The component reads five unrelated pieces of
 * data — `tx.date`, `tx.amount`, `tx.note`, `tx.account.name`,
 * `tx.category.{name,color}` — and in the default (eager) query mode
 * every one of those reads is already resolved, so this renders
 * synchronously. Switch the toggle to "lazy" and each row will suspend
 * on its first render while relations stream in; the component code
 * doesn't know the difference.
 */
export const TransactionRow = observer(function TransactionRow({
  tx,
  state,
}: {
  tx: Transaction;
  state: AppState;
}) {
  const amount = use(tx.amount);
  const note = use(tx.note);
  const date = use(tx.date);
  const category = use(tx.category);
  const account = use(tx.account);

  const categoryName = category ? use(category.name) : "Uncategorized";
  const categoryColor = category ? use(category.color) : "#9ca3af";
  const accountName = use(account.name);

  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors">
      <div
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: categoryColor }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {note ?? categoryName}
          </span>
          {note && (
            <Badge variant="secondary" className="text-[10px] font-normal">
              {categoryName}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {accountName} · {formatDate(date)}
        </div>
      </div>
      <div
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          amount < 0 ? "text-destructive" : "text-success",
        )}
      >
        {amount > 0 ? "+" : ""}
        {formatMoney(amount)}
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          void state.deleteTransaction(tx);
        }}
        aria-label="Delete transaction"
        className="shrink-0 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
});
