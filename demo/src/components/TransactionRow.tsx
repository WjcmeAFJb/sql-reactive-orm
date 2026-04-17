import { orm } from "@/db/orm";
import { use } from "react";
import { ArrowLeftRight, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { Transaction } from "@/db/entities";
import { deleteTransaction } from "@/db/actions";
import { ui } from "@/ui/ui-state";

export function TransactionRow({ tx }: { tx: Transaction }) {
  
  const amount = use(tx.amount);
  const note = use(tx.note);
  const date = use(tx.date);
  const transferId = use(tx.transferId);
  const category = use(tx.category);
  const account = use(tx.account);

  const isTransfer = transferId != null;
  const categoryName = category ? use(category.name) : null;
  const categoryColor = category ? use(category.color) : null;
  const accountName = use(account.name);
  const accountColor = use(account.color);

  const dotColor = isTransfer ? accountColor : (categoryColor ?? "#9ca3af");

  return (
    <div className="group flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors">
      <div
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: dotColor }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {isTransfer
              ? (note ?? (amount < 0 ? "Transfer out" : "Transfer in"))
              : (note ?? categoryName ?? "Uncategorized")}
          </span>
          {isTransfer ? (
            <Badge
              variant="secondary"
              className="gap-1 text-[10px] font-normal"
            >
              <ArrowLeftRight className="size-3" /> transfer
            </Badge>
          ) : note && categoryName ? (
            <Badge variant="secondary" className="text-[10px] font-normal">
              {categoryName}
            </Badge>
          ) : null}
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
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {!isTransfer && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => ui.openEditTx(tx)}
            aria-label="Edit transaction"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Pencil className="size-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void deleteTransaction(orm, tx)}
          aria-label="Delete transaction"
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}
