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
import { Account } from "@/db/entities";
import { useOrm } from "@/db/orm-context";
import { transferBetween } from "@/db/actions";

export const TransferForm = observer(function TransferForm({
  onDone,
}: {
  onDone: () => void;
}) {
  const orm = useOrm();
  const accounts = use(orm.findAll(Account, { orderBy: "id" }));

  const [fromId, setFromId] = useState(String(accounts[0]?.id ?? ""));
  const [toId, setToId] = useState(
    String(accounts[1]?.id ?? accounts[0]?.id ?? ""),
  );
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const n = parseFloat(amount);
    if (!Number.isFinite(n) || fromId === toId) return;
    setBusy(true);
    try {
      await transferBetween(orm, {
        fromAccountId: Number(fromId),
        toAccountId: Number(toId),
        amount: Math.abs(n),
        note: note || null,
        date,
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="from">From</Label>
          <Select value={fromId} onValueChange={setFromId}>
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
          <Select value={toId} onValueChange={setToId}>
            <SelectTrigger id="to">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts
                .filter((a) => String(a.id) !== fromId)
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
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
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
        <Button type="submit" disabled={busy || !amount || fromId === toId}>
          {busy ? "Saving…" : "Move money"}
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
