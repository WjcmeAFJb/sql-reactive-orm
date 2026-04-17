import { observer } from "mobx-react-lite";
import { use, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { todayISO } from "@/lib/utils";
import type { AppState } from "@/db/state";

/**
 * Pure form logic — talks to the ORM via `state.addTransaction`. The
 * dropdowns just iterate the `accounts` / `categories` Query results;
 * because those queries are reactive, adding or renaming an account
 * elsewhere is immediately reflected here.
 */
export const TransactionForm = observer(function TransactionForm({
  state,
  onDone,
}: {
  state: AppState;
  onDone: () => void;
}) {
  const accounts = state.accounts.result ?? use(state.accounts.promise);
  const categories = state.categories.result ?? use(state.categories.promise);

  const [accountId, setAccountId] = useState<string>(
    String(accounts[0]?.id ?? ""),
  );
  const [categoryId, setCategoryId] = useState<string>("none");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayISO());
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!Number.isFinite(parsed)) return;
    setSubmitting(true);
    try {
      await state.addTransaction({
        accountId: Number(accountId),
        categoryId: categoryId === "none" ? null : Number(categoryId),
        amount: kind === "expense" ? -Math.abs(parsed) : Math.abs(parsed),
        note: note || null,
        date,
      });
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="kind">Type</Label>
          <Select
            value={kind}
            onValueChange={(v) => setKind(v as typeof kind)}
          >
            <SelectTrigger id="kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="expense">Expense</SelectItem>
              <SelectItem value="income">Income</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="amount">Amount</Label>
          <Input
            id="amount"
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            required
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="account">Account</Label>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger id="account">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <AccountOption key={a.id} id={a.id} name={a.name} />
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="category">Category</Label>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger id="category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Uncategorized</SelectItem>
            {categories
              .filter(() => true)
              .map((c) => (
                <CategoryOption
                  key={c.id}
                  id={c.id}
                  name={c.name}
                  kind={c.kind}
                  filterKind={kind}
                />
              ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="date">Date</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="note">Note</Label>
          <Input
            id="note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || !amount}>
          {submitting ? "Saving…" : "Add transaction"}
        </Button>
      </div>
    </form>
  );
});

// Sub-components let us call `use` on the entity fields without hoisting
// async reads to the parent. Each render scopes its own suspense.
const AccountOption = observer(function AccountOption({
  id,
  name,
}: {
  id: number;
  name: Promise<string>;
}) {
  return <SelectItem value={String(id)}>{use(name)}</SelectItem>;
});

const CategoryOption = observer(function CategoryOption({
  id,
  name,
  kind,
  filterKind,
}: {
  id: number;
  name: Promise<string>;
  kind: Promise<"income" | "expense">;
  filterKind: "income" | "expense";
}) {
  if (use(kind) !== filterKind) return null;
  return <SelectItem value={String(id)}>{use(name)}</SelectItem>;
});
