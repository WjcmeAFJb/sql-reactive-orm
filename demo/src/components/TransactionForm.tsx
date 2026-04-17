import { observer, useLocalObservable } from "mobx-react-lite";
import { use, type FormEvent } from "react";
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
import { ui } from "@/ui/ui-state";

export type TxFormMode =
  | { kind: "create" }
  | { kind: "edit"; tx: Transaction };

export const TransactionForm = observer(function TransactionForm({
  mode,
}: {
  mode: TxFormMode;
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

  const s = useLocalObservable(() => ({
    kind: (initial && initial.amount > 0 ? "income" : "expense") as
      | "income"
      | "expense",
    accountId: String(initial?.accountId ?? accounts[0]?.id ?? ""),
    categoryId:
      initial?.categoryId != null ? String(initial.categoryId) : "none",
    amount: initial ? String(Math.abs(initial.amount)) : "",
    note: initial?.note ?? "",
    date: initial?.date ?? todayISO(),
    busy: false,
  }));

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const n = parseFloat(s.amount);
    if (!Number.isFinite(n)) return;
    s.busy = true;
    const payload = {
      accountId: Number(s.accountId),
      categoryId: s.categoryId === "none" ? null : Number(s.categoryId),
      amount: s.kind === "expense" ? -Math.abs(n) : Math.abs(n),
      note: s.note || null,
      date: s.date,
    };
    try {
      if (mode.kind === "edit") {
        await orm.update(mode.tx, payload);
      } else {
        await orm.insert(Transaction, { ...payload, transferId: null });
      }
      ui.close();
    } finally {
      s.busy = false;
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="kind">Type</Label>
          <Select
            value={s.kind}
            onValueChange={(v) => (s.kind = v as typeof s.kind)}
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
            value={s.amount}
            onChange={(e) => (s.amount = e.target.value)}
            placeholder="0.00"
            required
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="account">Account</Label>
        <Select value={s.accountId} onValueChange={(v) => (s.accountId = v)}>
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
        <Select value={s.categoryId} onValueChange={(v) => (s.categoryId = v)}>
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
                filterKind={s.kind}
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
            value={s.date}
            onChange={(e) => (s.date = e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="note">Note</Label>
          <Input
            id="note"
            type="text"
            value={s.note}
            onChange={(e) => (s.note = e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={() => ui.close()}>
          Cancel
        </Button>
        <Button type="submit" disabled={s.busy || !s.amount}>
          {s.busy
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
