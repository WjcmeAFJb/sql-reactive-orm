import { Suspense, use, useState } from "react";
import { observer } from "mobx-react-lite";
import { ormPromise } from "@/db/orm";
import { OrmProvider } from "@/db/orm-context";
import { Account, Transaction } from "@/db/entities";
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

type DialogState =
  | { kind: "none" }
  | { kind: "newTx" }
  | { kind: "editTx"; tx: Transaction }
  | { kind: "transfer" }
  | { kind: "newAccount" }
  | { kind: "editAccount"; account: Account }
  | { kind: "categories" };

/**
 * The root. The only stateful thing it keeps is which dialog is open —
 * every list view calls `use(orm.findAll(…))` inline, every mutation is
 * an inline `orm.insert` / `orm.update` / `orm.delete` or one of the
 * compound helpers in `db/actions.ts`.
 */
export const App = observer(function App() {
  const orm = use(ormPromise);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const close = () => setDialog({ kind: "none" });

  return (
    <OrmProvider value={orm}>
      <div className="min-h-screen bg-muted/30">
        <HeaderBar
          onAddTx={() => setDialog({ kind: "newTx" })}
          onTransfer={() => setDialog({ kind: "transfer" })}
          onCategories={() => setDialog({ kind: "categories" })}
        />

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
            <AccountList
              onAdd={() => setDialog({ kind: "newAccount" })}
              onEdit={(a) => setDialog({ kind: "editAccount", account: a })}
            />
          </Suspense>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
            <Suspense fallback={<Skeleton className="h-80" />}>
              <TransactionList
                onEdit={(tx) => setDialog({ kind: "editTx", tx })}
              />
            </Suspense>
            <Suspense fallback={<Skeleton className="h-80" />}>
              <CategoryBreakdown />
            </Suspense>
          </div>
        </main>

        <Dialog
          open={dialog.kind !== "none"}
          onOpenChange={(o) => !o && close()}
        >
          <DialogContent>
            {dialog.kind === "newTx" && (
              <>
                <DialogHeader>
                  <DialogTitle>New transaction</DialogTitle>
                </DialogHeader>
                <Suspense fallback={<Skeleton className="h-72" />}>
                  <TransactionForm mode={{ kind: "create" }} onDone={close} />
                </Suspense>
              </>
            )}
            {dialog.kind === "editTx" && (
              <>
                <DialogHeader>
                  <DialogTitle>Edit transaction</DialogTitle>
                  <DialogDescription>
                    Fields are pre-filled synchronously from the entity cache
                    via <code>use(tx.field)</code>.
                  </DialogDescription>
                </DialogHeader>
                <Suspense fallback={<Skeleton className="h-72" />}>
                  <TransactionForm
                    mode={{ kind: "edit", tx: dialog.tx }}
                    onDone={close}
                  />
                </Suspense>
              </>
            )}
            {dialog.kind === "transfer" && (
              <>
                <DialogHeader>
                  <DialogTitle>Transfer between accounts</DialogTitle>
                  <DialogDescription>
                    Two linked transactions inserted in a BEGIN/COMMIT — the
                    reactive driver collapses it to a single refetch.
                  </DialogDescription>
                </DialogHeader>
                <Suspense fallback={<Skeleton className="h-72" />}>
                  <TransferForm onDone={close} />
                </Suspense>
              </>
            )}
            {dialog.kind === "newAccount" && (
              <>
                <DialogHeader>
                  <DialogTitle>New account</DialogTitle>
                </DialogHeader>
                <AccountForm mode={{ kind: "create" }} onDone={close} />
              </>
            )}
            {dialog.kind === "editAccount" && (
              <>
                <DialogHeader>
                  <DialogTitle>Edit account</DialogTitle>
                  <DialogDescription>
                    Deleting cascades to this account's transactions.
                  </DialogDescription>
                </DialogHeader>
                <Suspense fallback={<Skeleton className="h-40" />}>
                  <AccountForm
                    mode={{ kind: "edit", account: dialog.account }}
                    onDone={close}
                  />
                </Suspense>
              </>
            )}
            {dialog.kind === "categories" && (
              <>
                <DialogHeader>
                  <DialogTitle>Categories</DialogTitle>
                  <DialogDescription>
                    Deleting a category nulls out <code>categoryId</code> on
                    its transactions.
                  </DialogDescription>
                </DialogHeader>
                <Suspense fallback={<Skeleton className="h-60" />}>
                  <CategoriesDialog />
                </Suspense>
              </>
            )}
          </DialogContent>
        </Dialog>

        <SqlConsole />
      </div>
    </OrmProvider>
  );
});
