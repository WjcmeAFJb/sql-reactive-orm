import { observer, useLocalObservable } from "mobx-react-lite";
import { use, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Account } from "@/db/entities";
import { useOrm } from "@/db/orm-context";
import { deleteAccount } from "@/db/actions";
import { ui } from "@/ui/ui-state";

export type AccountFormMode =
  | { kind: "create" }
  | { kind: "edit"; account: Account };

const COLORS = [
  "#3b82f6",
  "#16a34a",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#14b8a6",
];

export const AccountForm = observer(function AccountForm({
  mode,
}: {
  mode: AccountFormMode;
}) {
  const orm = useOrm();
  const initial =
    mode.kind === "edit"
      ? {
          name: use(mode.account.name) as string,
          color: use(mode.account.color) as string,
          initialBalance: use(mode.account.initialBalance) as number,
        }
      : null;

  const s = useLocalObservable(() => ({
    name: initial?.name ?? "",
    color: initial?.color ?? COLORS[0]!,
    initialBalance: initial ? String(initial.initialBalance) : "0",
    busy: false,
  }));

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!s.name.trim()) return;
    const bal = parseFloat(s.initialBalance);
    if (!Number.isFinite(bal)) return;
    s.busy = true;
    try {
      if (mode.kind === "edit") {
        await orm.update(mode.account, {
          name: s.name.trim(),
          color: s.color,
          initialBalance: bal,
        });
      } else {
        await orm.insert(Account, {
          name: s.name.trim(),
          color: s.color,
          initialBalance: bal,
        });
      }
      ui.close();
    } finally {
      s.busy = false;
    }
  }

  async function handleDelete(): Promise<void> {
    if (mode.kind !== "edit") return;
    if (
      !confirm(
        "Delete this account and all its transactions? This can't be undone.",
      )
    )
      return;
    s.busy = true;
    try {
      await deleteAccount(orm, mode.account);
      ui.close();
    } finally {
      s.busy = false;
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={s.name}
          onChange={(e) => (s.name = e.target.value)}
          placeholder="Checking"
          autoFocus
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label>Color</Label>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => (s.color = c)}
              className={
                "size-7 rounded-full border transition " +
                (s.color === c
                  ? "ring-2 ring-offset-2 ring-[--color-ring] border-background"
                  : "border-transparent hover:scale-110")
              }
              style={{ backgroundColor: c }}
              aria-label={`Pick color ${c}`}
            />
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bal">Initial balance</Label>
        <Input
          id="bal"
          type="number"
          step="0.01"
          value={s.initialBalance}
          onChange={(e) => (s.initialBalance = e.target.value)}
          required
        />
      </div>

      <div className="flex justify-between pt-2">
        <div>
          {mode.kind === "edit" && (
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={s.busy}
            >
              Delete
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => ui.close()}>
            Cancel
          </Button>
          <Button type="submit" disabled={s.busy || !s.name.trim()}>
            {s.busy
              ? "Saving…"
              : mode.kind === "edit"
                ? "Save"
                : "Add account"}
          </Button>
        </div>
      </div>
    </form>
  );
});
