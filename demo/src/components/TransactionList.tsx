import { observer } from "mobx-react-lite";
import { use } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TransactionRow } from "./TransactionRow";
import { Transaction } from "@/db/entities";
import { useOrm } from "@/db/orm-context";

export const TransactionList = observer(function TransactionList() {
  const orm = useOrm();
  const rows = use(
    orm.findAll(Transaction, {
      orderBy: [
        ["date", "desc"],
        ["id", "desc"],
      ],
      with: { account: true, category: true },
    }),
  );

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
              <TransactionRow key={tx.id} tx={tx} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
});
