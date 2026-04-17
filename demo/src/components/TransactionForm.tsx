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
import { Account, Category, Transaction } from "@/db/entities";
import { useOrm } from "@/db/orm-context";

export type TxFormMode =
  | { kind: "create" }
  | { kind: "edit"; tx: Transaction };

/**
 * Create or edit a regular (non-transfer) transaction. For edit mode,
 * initial values come straight from the entity getters via `use` — no
 * separate load path.
 */
export const TransactionForm = observer(function TransactionForm({
  mode,
  onDone,
}: {
  mode: TxFormMode;
  onDone: () => void;
}) {
  const orm = useOrm();
  const accounts = use(orm.findAll(Account, { orderBy: "id" }));
  const categories = use(orm.findAll(Category, { orderBy: "id" }));

  const initial =
    mode.kind === "edit"
      ? {
          amount: use(mode.tx.amount) as number,
          accountId: use(mode.tx.accountId) as number,
          categoryId: use(mode.tx.categoryId) as number | null,
          note: use(mode.tx.note) as string | null,
          date: use(mode.tx.date) as string,
        }
      : null;

  const initialKind: "income" | "expense" =
    initial && initial.amount > 0 ? "income" : "expense";

  const [kind, setKind] = useState<"income" | "expense">(initialKind);
  const [accountId, setAccountId] = useState<string>(
    String(initial?.accountId ?? accounts[0]?.id ?? ""),
  );
  const [categoryId, setCategoryId] = useState<string>(
    initial?.categoryId != null ? String(initial.categoryId) : "none",
  );
  const [amount, setAmount] = useState(
    initial ? String(Math.abs(initial.amount)) : "",
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const n = parseFloat(amount);
    if (!Number.isFinite(n)) return;
    setBusy(true);
    const payload = {
      accountId: Number(accountId),
      categoryId: categoryId === "none" ? null : Number(categoryId),
      amount: kind === "expense" ? -Math.abs(n) : Math.abs(n),
      note: note || null,
      date,
    };
    try {
      if (mode.kind === "edit") {
        await orm.update(mode.tx, payload);
      } else {
        await orm.insert(Transaction, { ...payload, transferId: null });
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="kind">Type</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
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
              <EntityNameOption key={a.id} id={a.id} name={a.name} />
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
            {categories.map((c) => (
              <CategoryKindOption
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
        <Button type="submit" disabled={busy || !amount}>
          {busy
            ? "Saving…"
            : mode.kind === "edit"
              ? "Save changes"
              : "Add transaction"}
        </Button>
      </div>
    </form>
  );
});

const EntityNameOption = observer(function EntityNameOption({
  id,
  name,
}: {
  id: number;
  name: Promise<string>;
}) {
  return <SelectItem value={String(id)}>{use(name)}</SelectItem>;
});

const CategoryKindOption = observer(function CategoryKindOption({
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
