import { observer } from "mobx-react-lite";
import { use } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatMoney } from "@/lib/utils";
import type { AppState } from "@/db/state";

/**
 * A trailing 30-day spend breakdown per category. Every field access on
 * entities is synchronous in eager mode, so this component reads like
 * plain TypeScript that happens to be reactive.
 */
export const CategoryBreakdown = observer(function CategoryBreakdown({
  state,
}: {
  state: AppState;
}) {
  const categories =
    state.categories.result ?? use(state.categories.promise);
  const txs = state.transactions.result ?? use(state.transactions.promise);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  const totals = new Map<number, number>();
  for (const t of txs) {
    const catId = use(t.categoryId);
    if (catId == null) continue;
    if (use(t.date) < cutoffISO) continue;
    const amt = use(t.amount) as number;
    totals.set(catId, (totals.get(catId) ?? 0) + amt);
  }

  const breakdown = categories
    .filter((c) => use(c.kind) === "expense" && (totals.get(c.id) ?? 0) < 0)
    .map((c) => ({
      id: c.id,
      name: use(c.name),
      color: use(c.color),
      total: Math.abs(totals.get(c.id) ?? 0),
    }))
    .sort((a, b) => b.total - a.total);

  const grandTotal = breakdown.reduce((s, x) => s + x.total, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Last 30 days</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {breakdown.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No expenses yet.
          </div>
        ) : (
          breakdown.map((b) => {
            const pct = grandTotal > 0 ? (b.total / grandTotal) * 100 : 0;
            return (
              <div key={b.id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div
                      className="size-2 rounded-full"
                      style={{ backgroundColor: b.color }}
                    />
                    <span>{b.name}</span>
                  </div>
                  <span className="tabular-nums text-muted-foreground">
                    {formatMoney(b.total)}
                  </span>
                </div>
                <div className="h-1.5 rounded bg-muted overflow-hidden">
                  <div
                    className={cn("h-full")}
                    style={{
                      width: `${pct}%`,
                      backgroundColor: b.color,
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
});
