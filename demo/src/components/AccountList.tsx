import { observer } from "mobx-react-lite";
import { use } from "react";
import { Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { AccountCard } from "./AccountCard";
import { Account } from "@/db/entities";
import { useOrm } from "@/db/orm-context";
import { ui } from "@/ui/ui-state";

export const AccountList = observer(function AccountList() {
  const orm = useOrm();
  const accounts = use(
    orm.findAll(Account, { orderBy: "id", with: { transactions: true } }),
  );
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {accounts.map((a) => (
        <AccountCard key={a.id} account={a} />
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
});
