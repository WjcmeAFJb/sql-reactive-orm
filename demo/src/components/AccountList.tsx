import { observer } from "mobx-react-lite";
import { use } from "react";
import { AccountCard } from "./AccountCard";
import type { AppState } from "@/db/state";

export const AccountList = observer(function AccountList({
  state,
}: {
  state: AppState;
}) {
  const accounts = state.accounts.result ?? use(state.accounts.promise);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {accounts.map((a) => (
        <AccountCard key={a.id} account={a} />
      ))}
    </div>
  );
});
