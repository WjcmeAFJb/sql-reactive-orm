import { Suspense, use, useState } from "react";
import { observer } from "mobx-react-lite";
import { ormPromise } from "@/db/orm";
import { getState } from "@/db/state";
import { HeaderBar } from "@/components/HeaderBar";
import { AccountList } from "@/components/AccountList";
import { TotalBalance } from "@/components/TotalBalance";
import { TransactionList } from "@/components/TransactionList";
import { TransactionForm } from "@/components/TransactionForm";
import { CategoryBreakdown } from "@/components/CategoryBreakdown";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The whole app fits in one screen. Reactivity means:
 *
 *   - Submitting `<TransactionForm>` inserts one row; the Queries that
 *     `TransactionList`, `AccountList`, `TotalBalance`, and
 *     `CategoryBreakdown` are subscribed to all refetch in one batch.
 *   - There is no manual cache key to bust, no onSuccess callback, no
 *     local optimistic-update plumbing. The ORM's identity map keeps
 *     each account/category/transaction as a single JS object across the
 *     whole tree, so `observer` re-renders exactly the components that
 *     read what changed.
 */
export const App = observer(function App() {
  const orm = use(ormPromise);
  const state = getState(orm);
  const [adding, setAdding] = useState(false);

  return (
    <div className="min-h-screen bg-muted/30">
      <HeaderBar state={state} onAdd={() => setAdding(true)} />

      <main className="mx-auto w-full max-w-6xl px-6 py-6 space-y-6">
        <Suspense fallback={<Skeleton className="h-10 w-64" />}>
          <TotalBalance state={state} />
        </Suspense>

        <Suspense
          fallback={
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          }
        >
          <AccountList state={state} />
        </Suspense>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
          <Suspense fallback={<Skeleton className="h-80" />}>
            <TransactionList state={state} />
          </Suspense>
          <Suspense fallback={<Skeleton className="h-80" />}>
            <CategoryBreakdown state={state} />
          </Suspense>
        </div>
      </main>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New transaction</DialogTitle>
            <DialogDescription>
              Inserted via <code>orm.insert()</code>. Every observer reading
              the affected entities re-renders automatically.
            </DialogDescription>
          </DialogHeader>
          <Suspense fallback={<Skeleton className="h-72" />}>
            <TransactionForm
              state={state}
              onDone={() => setAdding(false)}
            />
          </Suspense>
        </DialogContent>
      </Dialog>
    </div>
  );
});
