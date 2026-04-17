import { orm } from "@/db/orm";
import { useLocalObservable } from "mobx-react-lite";
import { use, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Account } from "@/db/entities";
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

type FormState = {
  name: string;
  color: string;
  initialBalance: string;
  busy: boolean;
};

export function AccountForm({ mode }: { mode: AccountFormMode }) {
  
  const initial =
    mode.kind === "edit"
      ? {
          name: use(mode.account.name) as string,
          color: use(mode.account.color) as string,
          initialBalance: use(mode.account.initialBalance) as number,
        }
      : null;

  const s = useLocalObservable<FormState>(() => ({
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
      await mode.account.remove();
      ui.close();
    } finally {
      s.busy = false;
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <NameInput state={s} />
      <ColorPicker state={s} />
      <InitialBalanceInput state={s} />
      <Footer state={s} mode={mode} onDelete={handleDelete} />
    </form>
  );
}

function NameInput({ state }: { state: FormState }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="name">Name</Label>
      <Input
        id="name"
        value={state.name}
        onChange={(e) => (state.name = e.target.value)}
        placeholder="Checking"
        autoFocus
        required
      />
    </div>
  );
}

function ColorPicker({ state }: { state: FormState }) {
  return (
    <div className="space-y-1.5">
      <Label>Color</Label>
      <div className="flex flex-wrap gap-2">
        {COLORS.map((c) => (
          <ColorSwatch key={c} state={state} color={c} />
        ))}
      </div>
    </div>
  );
}

function ColorSwatch({ state, color }: { state: FormState; color: string }) {
  return (
    <button
      type="button"
      onClick={() => (state.color = color)}
      className={
        "size-7 rounded-full border transition " +
        (state.color === color
          ? "ring-2 ring-offset-2 ring-[--color-ring] border-background"
          : "border-transparent hover:scale-110")
      }
      style={{ backgroundColor: color }}
      aria-label={`Pick color ${color}`}
    />
  );
}

function InitialBalanceInput({ state }: { state: FormState }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="bal">Initial balance</Label>
      <Input
        id="bal"
        type="number"
        step="0.01"
        value={state.initialBalance}
        onChange={(e) => (state.initialBalance = e.target.value)}
        required
      />
    </div>
  );
}

function Footer({
  state,
  mode,
  onDelete,
}: {
  state: FormState;
  mode: AccountFormMode;
  onDelete: () => void;
}) {
  return (
    <div className="flex justify-between pt-2">
      <div>
        {mode.kind === "edit" && <DeleteButton state={state} onClick={onDelete} />}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={() => ui.close()}>
          Cancel
        </Button>
        <SubmitButton state={state} mode={mode} />
      </div>
    </div>
  );
}

function DeleteButton({
  state,
  onClick,
}: {
  state: FormState;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="destructive"
      onClick={onClick}
      disabled={state.busy}
    >
      Delete
    </Button>
  );
}

function SubmitButton({
  state,
  mode,
}: {
  state: FormState;
  mode: AccountFormMode;
}) {
  return (
    <Button type="submit" disabled={state.busy || !state.name.trim()}>
      {state.busy
        ? "Saving…"
        : mode.kind === "edit"
          ? "Save"
          : "Add account"}
    </Button>
  );
}
