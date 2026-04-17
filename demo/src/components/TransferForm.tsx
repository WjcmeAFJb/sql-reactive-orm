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
import { Account } from "@/db/entities";
import { useOrm } from "@/db/orm-context";
import { transferBetween } from "@/db/actions";
import { ui } from "@/ui/ui-state";

export const TransferForm = observer(function TransferForm() {
  const orm = useOrm();
  const accounts = use(orm.findAll(Account, { orderBy: "id" }));

  const s = useLocalObservable(() => ({
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
        <div className="space-y-1.5">
          <Label htmlFor="from">From</Label>
          <Select value={s.fromId} onValueChange={(v) => (s.fromId = v)}>
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
        <div className="space-y-1.5">
          <Label htmlFor="to">To</Label>
          <Select value={s.toId} onValueChange={(v) => (s.toId = v)}>
            <SelectTrigger id="to">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts
                .filter((a) => String(a.id) !== s.fromId)
                .map((a) => (
                  <AccountOption key={a.id} id={a.id} name={a.name} />
                ))}
            </SelectContent>
          </Select>
        </div>
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
        <Button
          type="submit"
          disabled={s.busy || !s.amount || s.fromId === s.toId}
        >
          {s.busy ? "Saving…" : "Move money"}
        </Button>
      </div>
    </form>
  );
});

const AccountOption = observer(function AccountOption({
  id,
  name,
}: {
  id: number;
  name: Promise<string>;
}) {
  return <SelectItem value={String(id)}>{use(name)}</SelectItem>;
});
