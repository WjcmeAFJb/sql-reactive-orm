import { use } from "react";
import { orm } from "@/db/orm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn, formatMoney } from "@/lib/utils";

/**
 * A pure SQL aggregate driving the breakdown. The ORM auto-watches
 * the `transactions` + `categories` tables (scanned from FROM/JOIN),
 * and on every mutation diffs the new rows against the previous ones
 * and patches in place, keyed by `id`. So when a single transaction
 * changes a single category's total, only the `BreakdownRow` reading
 * that category's `.total` re-renders — not the whole list.
 */
export function CategoryBreakdown() {
  const rows = use(
    orm.sqlQuery<{
      id: number;
      name: string;
      color: string;
      total: number;
    }>(
      `SELECT c.id, c.name, c.color, ABS(SUM(t.amount)) AS total
         FROM categories c
         JOIN transactions t
           ON t.categoryId = c.id
          AND t.amount < 0
          AND t.date >= date('now','-30 days')
        WHERE c.kind = 'expense'
        GROUP BY c.id
        ORDER BY total DESC`,
      [],
      { keyBy: (r) => r.id },
    ),
  );

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Last 30 days</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No expenses yet.</div>
        ) : (
          rows.map((r) => (
            <BreakdownRow key={r.id} row={r} grandTotal={grandTotal} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function BreakdownRow({
  row,
  grandTotal,
}: {
  row: { name: string; color: string; total: number };
  grandTotal: number;
}) {
  const pct = grandTotal > 0 ? (row.total / grandTotal) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <div
            className="size-2 rounded-full"
            style={{ backgroundColor: row.color }}
          />
          <span>{row.name}</span>
        </div>
        <span className="tabular-nums text-muted-foreground">
          {formatMoney(row.total)}
        </span>
      </div>
      <div className="h-1.5 rounded bg-muted overflow-hidden">
        <div
          className={cn("h-full")}
          style={{ width: `${pct}%`, backgroundColor: row.color }}
        />
      </div>
    </div>
  );
}
