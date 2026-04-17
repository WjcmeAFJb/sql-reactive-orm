import { Suspense, use } from "react";
import { observer } from "mobx-react-lite";
import { ormPromise } from "@/db/orm";
import { OrmProvider } from "@/db/orm-context";
import { ui } from "@/ui/ui-state";
import { HeaderBar } from "@/components/HeaderBar";
import { AccountList } from "@/components/AccountList";
import { TotalBalance } from "@/components/TotalBalance";
import { TransactionList } from "@/components/TransactionList";
import { TransactionForm } from "@/components/TransactionForm";
import { TransferForm } from "@/components/TransferForm";
import { AccountForm } from "@/components/AccountForm";
import { CategoriesDialog } from "@/components/CategoriesDialog";
import { CategoryBreakdown } from "@/components/CategoryBreakdown";
import { SqlConsole } from "@/components/SqlConsole";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Root. Reads nothing reactive itself, so opening a dialog / flipping
 * the console does not re-render it — only the `DialogRoot` sub-tree
 * below (which is the only thing observing `ui.dialog`) updates.
 */
export function App() {
  const orm = use(ormPromise);
  return (
    <OrmProvider value={orm}>
      <div className="min-h-screen bg-muted/30">
        <HeaderBar />

        <main className="mx-auto w-full max-w-6xl space-y-6 px-6 py-6 pb-24">
          <Suspense fallback={<Skeleton className="h-10 w-64" />}>
            <TotalBalance />
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
            <AccountList />
          </Suspense>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
            <Suspense fallback={<Skeleton className="h-80" />}>
              <TransactionList />
            </Suspense>
            <Suspense fallback={<Skeleton className="h-80" />}>
              <CategoryBreakdown />
            </Suspense>
          </div>
        </main>

        <DialogRoot />
        <SqlConsole />
      </div>
    </OrmProvider>
  );
}

/**
 * The only part of the app that reads `ui.dialog`. Re-renders on every
 * open / close — the rest of the tree is oblivious.
 */
const DialogRoot = observer(function DialogRoot() {
  const d = ui.dialog;
  return (
    <Dialog open={d.kind !== "none"} onOpenChange={(o) => !o && ui.close()}>
      <DialogContent>
        {d.kind === "newTx" && (
          <>
            <DialogHeader>
              <DialogTitle>New transaction</DialogTitle>
            </DialogHeader>
            <Suspense fallback={<Skeleton className="h-72" />}>
              <TransactionForm mode={{ kind: "create" }} />
            </Suspense>
          </>
        )}
        {d.kind === "editTx" && (
          <>
            <DialogHeader>
              <DialogTitle>Edit transaction</DialogTitle>
              <DialogDescription>
                Fields pre-filled synchronously from the entity cache via{" "}
                <code>use(tx.field)</code>.
              </DialogDescription>
            </DialogHeader>
            <Suspense fallback={<Skeleton className="h-72" />}>
              <TransactionForm mode={{ kind: "edit", tx: d.tx }} />
            </Suspense>
          </>
        )}
        {d.kind === "transfer" && (
          <>
            <DialogHeader>
              <DialogTitle>Transfer between accounts</DialogTitle>
              <DialogDescription>
                Two linked transactions inserted in a BEGIN/COMMIT — the
                reactive driver collapses it to a single refetch.
              </DialogDescription>
            </DialogHeader>
            <Suspense fallback={<Skeleton className="h-72" />}>
              <TransferForm />
            </Suspense>
          </>
        )}
        {d.kind === "newAccount" && (
          <>
            <DialogHeader>
              <DialogTitle>New account</DialogTitle>
            </DialogHeader>
            <AccountForm mode={{ kind: "create" }} />
          </>
        )}
        {d.kind === "editAccount" && (
          <>
            <DialogHeader>
              <DialogTitle>Edit account</DialogTitle>
              <DialogDescription>
                Deleting cascades to this account's transactions.
              </DialogDescription>
            </DialogHeader>
            <Suspense fallback={<Skeleton className="h-40" />}>
              <AccountForm mode={{ kind: "edit", account: d.account }} />
            </Suspense>
          </>
        )}
        {d.kind === "categories" && (
          <>
            <DialogHeader>
              <DialogTitle>Categories</DialogTitle>
              <DialogDescription>
                Deleting a category nulls out <code>categoryId</code> on its
                transactions.
              </DialogDescription>
            </DialogHeader>
            <Suspense fallback={<Skeleton className="h-60" />}>
              <CategoriesDialog />
            </Suspense>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
});
