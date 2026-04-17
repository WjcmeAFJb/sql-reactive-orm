import { orm } from "@/db/orm";
import { useLocalObservable } from "mobx-react-lite";
import { use, type SubmitEvent } from "react";
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
import { ui } from "@/ui/ui-state";

export type TxFormMode = { kind: "create" } | { kind: "edit"; tx: Transaction };

type Kind = "income" | "expense";

type FormState = {
  kind: Kind;
  accountId: string;
  categoryId: string;
  amount: string;
  note: string;
  date: string;
  busy: boolean;
};

/**
 * The form is a plain JSX tree handing a single observable `state`
 * object to each input. Because every nested component reads exactly
 * one (or two) slots of that state, typing into "Amount" re-renders
 * only `AmountInput`; flipping "Type" re-renders only `TypeSelect`
 * plus `CategorySelect` (which filters by type). The form root
 * itself never re-renders on keystrokes.
 */
export function TransactionForm({ mode }: { mode: TxFormMode }) {
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

  const s = useLocalObservable<FormState>(() => ({
    kind: initial && initial.amount > 0 ? "income" : "expense",
    accountId: String(initial?.accountId ?? accounts[0]?.id ?? ""),
    categoryId: initial?.categoryId != null ? String(initial.categoryId) : "none",
    amount: initial ? String(Math.abs(initial.amount)) : "",
    note: initial?.note ?? "",
    date: initial?.date ?? todayISO(),
    busy: false,
  }));

  async function submit(e: SubmitEvent): Promise<void> {
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
        <TypeSelect state={s} />
        <AmountInput state={s} />
      </div>
      <AccountSelect state={s} accounts={accounts} />
      <CategorySelect state={s} categories={categories} />
      <div className="grid grid-cols-2 gap-3">
        <DateInput state={s} />
        <NoteInput state={s} />
      </div>
      <Footer state={s} mode={mode} />
    </form>
  );
}

// ---- per-input components ----

function TypeSelect({ state }: { state: FormState }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="kind">Type</Label>
      <Select value={state.kind} onValueChange={(v) => (state.kind = v as Kind)}>
        <SelectTrigger id="kind">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="expense">Expense</SelectItem>
          <SelectItem value="income">Income</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function AmountInput({ state }: { state: FormState }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="amount">Amount</Label>
      <Input
        id="amount"
        type="number"
        step="0.01"
        min="0"
        value={state.amount}
        onChange={(e) => (state.amount = e.target.value)}
        placeholder="0.00"
        required
      />
    </div>
  );
}

function AccountSelect({ state, accounts }: { state: FormState; accounts: readonly Account[] }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="account">Account</Label>
      <Select value={state.accountId} onValueChange={(v) => (state.accountId = v)}>
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
  );
}

function CategorySelect({
  state,
  categories,
}: {
  state: FormState;
  categories: readonly Category[];
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="category">Category</Label>
      <Select value={state.categoryId} onValueChange={(v) => (state.categoryId = v)}>
        <SelectTrigger id="category">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Uncategorized</SelectItem>
          {categories.map((c) => (
            <CategoryOption
              key={c.id}
              id={c.id}
              name={c.name}
              kind={c.kind}
              filterKind={state.kind}
            />
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DateInput({ state }: { state: FormState }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="date">Date</Label>
      <Input
        id="date"
        type="date"
        value={state.date}
        onChange={(e) => (state.date = e.target.value)}
        required
      />
    </div>
  );
}

function NoteInput({ state }: { state: FormState }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="note">Note</Label>
      <Input
        id="note"
        type="text"
        value={state.note}
        onChange={(e) => (state.note = e.target.value)}
        placeholder="Optional"
      />
    </div>
  );
}

function Footer({ state, mode }: { state: FormState; mode: TxFormMode }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="ghost" onClick={() => ui.close()}>
        Cancel
      </Button>
      <SubmitButton state={state} mode={mode} />
    </div>
  );
}

function SubmitButton({ state, mode }: { state: FormState; mode: TxFormMode }) {
  return (
    <Button type="submit" disabled={state.busy || !state.amount}>
      {state.busy ? "Saving…" : mode.kind === "edit" ? "Save changes" : "Add transaction"}
    </Button>
  );
}

function EntityNameOption({ id, name }: { id: number; name: Promise<string> }) {
  return <SelectItem value={String(id)}>{use(name)}</SelectItem>;
}

function CategoryOption({
  id,
  name,
  kind,
  filterKind,
}: {
  id: number;
  name: Promise<string>;
  kind: Promise<"income" | "expense">;
  filterKind: Kind;
}) {
  if (use(kind) !== filterKind) return null;
  return <SelectItem value={String(id)}>{use(name)}</SelectItem>;
}
