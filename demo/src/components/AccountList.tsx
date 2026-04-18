import { use } from "react";
import { sql } from "kysely";
import { Plus } from "lucide-react";
import { orm } from "@/db/orm";
import { Card } from "@/components/ui/card";
import { AccountCard } from "./AccountCard";
import { Account } from "@/db/entities";
import { ui } from "@/ui/ui-state";

export function AccountList() {
  const accounts = use(orm.findAll(Account, { orderBy: "id" }));
  const stats = use(
    orm.sqlQuery(
      (db) =>
        db
          .selectFrom("accounts as a")
          .leftJoin("transactions as t", "t.accountId", "a.id")
          .select("a.id")
          .select(sql<number>`a.initialBalance + COALESCE(SUM(t.amount), 0)`.as("balance"))
          .select((eb) => eb.fn.count<number>("t.id").as("txCount"))
          .groupBy("a.id"),
      { keyBy: (r) => r.id },
    ),
  );
  const statsById = new Map(stats.map((s) => [s.id, s]));

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {accounts.map((a) => (
        <AccountCard key={a.id} account={a} stats={statsById.get(a.id)} />
      ))}
      <Card
        role="button"
        tabIndex={0}
        onClick={() => ui.openNewAccount()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") ui.openNewAccount();
        }}
        className="flex cursor-pointer items-center justify-center border-dashed p-5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <Plus className="mr-1 size-4" /> Add account
      </Card>
    </div>
  );
}
