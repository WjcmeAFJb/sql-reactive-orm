import { use } from "react";
import { sql } from "kysely";
import { orm } from "@/db/orm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn, formatMoney } from "@/lib/utils";

/**
 * A kysely-authored aggregate driving the breakdown — no SQL strings,
 * no type annotations. The row shape (`id`, `name`, `color`, `total`)
 * is inferred straight from the builder via the generated `DB` type.
 *
 * On every mutation to the watched tables the ORM auto-refetches,
 * then diffs the new rows against the old ones (keyed by `id`) and
 * patches in place. So when a single transaction moves a single
 * category's total, only the `BreakdownRow` reading that category's
 * `.total` re-renders.
 */
export function CategoryBreakdown() {
  const rows = use(
    orm.sqlQuery(
      (db) =>
        db
          .selectFrom("categories as c")
          .innerJoin("transactions as t", (join) =>
            join
              .onRef("t.categoryId", "=", "c.id")
              .on("t.amount", "<", 0)
              .on("t.date", ">=", sql<string>`date('now', '-30 days')`),
          )
          .where("c.kind", "=", "expense")
          .select(["c.id", "c.name", "c.color"])
          .select((eb) => eb.fn.sum<number>("t.amount").as("total"))
          .groupBy("c.id")
          .orderBy("total", "asc"),
      { keyBy: (r) => r.id },
    ),
  );

  const grandTotal = rows.reduce((s, r) => s + Math.abs(r.total), 0);

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
  const abs = Math.abs(row.total);
  const pct = grandTotal > 0 ? (abs / grandTotal) * 100 : 0;
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
          {formatMoney(abs)}
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
