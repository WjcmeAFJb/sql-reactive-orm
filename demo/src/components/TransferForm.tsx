import { orm } from "@/db/orm";
import { useLocalObservable } from "mobx-react-lite";
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
import { Account } from "@/db/entities";
import { transferBetween } from "@/db/actions";
import { ui } from "@/ui/ui-state";

type FormState = {
  fromId: string;
  toId: string;
  amount: string;
  note: string;
  date: string;
  busy: boolean;
};

export function TransferForm() {
  
  const accounts = use(orm.findAll(Account, { orderBy: "id" }));

  const s = useLocalObservable<FormState>(() => ({
    fromId: String(accounts[0]?.id ?? ""),
    toId: String(accounts[1]?.id ?? accounts[0]?.id ?? ""),
    amount: "",
    note: "",
    date: todayISO(),
    busy: false,
  }));

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const n = parseFloat(s.amount);
    if (!Number.isFinite(n) || s.fromId === s.toId) return;
    s.busy = true;
    try {
      await transferBetween(orm, {
        fromAccountId: Number(s.fromId),
        toAccountId: Number(s.toId),
        amount: Math.abs(n),
        note: s.note || null,
        date: s.date,
      });
      ui.close();
    } finally {
      s.busy = false;
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <FromSelect state={s} accounts={accounts} />
        <ToSelect state={s} accounts={accounts} />
      </div>
      <AmountInput state={s} />
      <div className="grid grid-cols-2 gap-3">
        <DateInput state={s} />
        <NoteInput state={s} />
      </div>
      <Footer state={s} />
    </form>
  );
}

function FromSelect({
  state,
  accounts,
}: {
  state: FormState;
  accounts: readonly Account[];
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="from">From</Label>
      <Select value={state.fromId} onValueChange={(v) => (state.fromId = v)}>
        <SelectTrigger id="from">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((a) => (
            <AccountOption key={a.id} id={a.id} name={a.name} />
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ToSelect({
  state,
  accounts,
}: {
  state: FormState;
  accounts: readonly Account[];
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="to">To</Label>
      <Select value={state.toId} onValueChange={(v) => (state.toId = v)}>
        <SelectTrigger id="to">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {accounts
            .filter((a) => String(a.id) !== state.fromId)
            .map((a) => (
              <AccountOption key={a.id} id={a.id} name={a.name} />
            ))}
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

function Footer({ state }: { state: FormState }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="ghost" onClick={() => ui.close()}>
        Cancel
      </Button>
      <SubmitButton state={state} />
    </div>
  );
}

function SubmitButton({ state }: { state: FormState }) {
  return (
    <Button
      type="submit"
      disabled={state.busy || !state.amount || state.fromId === state.toId}
    >
      {state.busy ? "Saving…" : "Move money"}
    </Button>
  );
}

function AccountOption({ id, name }: { id: number; name: Promise<string> }) {
  return <SelectItem value={String(id)}>{use(name)}</SelectItem>;
}
