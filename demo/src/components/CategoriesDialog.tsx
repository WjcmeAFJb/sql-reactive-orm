import { orm } from "@/db/orm";
import { useLocalObservable } from "mobx-react-lite";
import { use, type FormEvent } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Category } from "@/db/entities";

const COLORS = [
  "#16a34a",
  "#22c55e",
  "#f97316",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#eab308",
  "#14b8a6",
  "#3b82f6",
];

export function CategoriesDialog() {
  
  const categories = use(orm.findAll(Category, { orderBy: "id" }));
  const s = useLocalObservable(() => ({
    editingId: null as number | null,
  }));

  return (
    <div className="space-y-4">
      <NewCategoryRow />
      <div className="border-t pt-2">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground pb-2">
          Existing ({categories.length})
        </div>
        <div className="max-h-[360px] overflow-y-auto -mx-6 px-6">
          {categories.map((c) =>
            s.editingId === c.id ? (
              <EditCategoryRow
                key={c.id}
                category={c}
                onDone={() => (s.editingId = null)}
              />
            ) : (
              <CategoryRow
                key={c.id}
                category={c}
                onEdit={() => (s.editingId = c.id)}
                onDelete={() => void c.remove()}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryRow({
  category,
  onEdit,
  onDelete,
}: {
  category: Category;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const name = use(category.name);
  const color = use(category.color);
  const kind = use(category.kind);
  const txs = use(category.transactions);

  return (
    <div className="flex items-center gap-3 py-1.5">
      <div
        className="size-3 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{name}</div>
        <div className="text-xs text-muted-foreground">
          {kind} · {txs.length} tx
        </div>
      </div>
      <Button variant="ghost" size="icon" onClick={onEdit}>
        <Pencil className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive"
        onClick={() => {
          if (
            confirm(
              `Delete "${name}"? Transactions using it will become uncategorized.`,
            )
          )
            onDelete();
        }}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

type EditFormState = {
  name: string;
  color: string;
  kind: "income" | "expense";
};

function EditCategoryRow({
  category,
  onDone,
}: {
  category: Category;
  onDone: () => void;
}) {
  
  const s = useLocalObservable<EditFormState>(() => ({
    name: use(category.name) as string,
    color: use(category.color) as string,
    kind: use(category.kind) as "income" | "expense",
  }));

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!s.name.trim()) return;
    await orm.update(category, {
      name: s.name.trim(),
      color: s.color,
      kind: s.kind,
    });
    onDone();
  }

  return (
    <form onSubmit={save} className="flex items-center gap-2 py-1.5">
      <ColorDot value={s.color} onChange={(c) => (s.color = c)} />
      <NameField state={s} />
      <KindField state={s} />
      <Button type="submit" size="icon" variant="ghost">
        <Check className="size-4" />
      </Button>
      <Button type="button" size="icon" variant="ghost" onClick={onDone}>
        <X className="size-4" />
      </Button>
    </form>
  );
}

type NewFormState = EditFormState;

function NewCategoryRow() {
  
  const s = useLocalObservable<NewFormState>(() => ({
    name: "",
    color: COLORS[0]!,
    kind: "expense",
  }));

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    const trimmed = s.name.trim();
    if (!trimmed) return;
    await orm.insert(Category, {
      name: trimmed,
      color: s.color,
      kind: s.kind,
    });
    s.name = "";
  }

  return (
    <form
      onSubmit={save}
      className="flex items-center gap-2 rounded-md border border-dashed p-2"
    >
      <ColorDot value={s.color} onChange={(c) => (s.color = c)} />
      <NewNameField state={s} />
      <KindField state={s} />
      <NewSubmit state={s} />
    </form>
  );
}

function NameField({ state }: { state: EditFormState }) {
  return (
    <Input
      value={state.name}
      onChange={(e) => (state.name = e.target.value)}
      className="h-8 flex-1"
      autoFocus
    />
  );
}

function NewNameField({ state }: { state: NewFormState }) {
  return (
    <Input
      value={state.name}
      onChange={(e) => (state.name = e.target.value)}
      placeholder="New category name"
      className="h-8 flex-1"
    />
  );
}

function KindField({ state }: { state: { kind: "income" | "expense" } }) {
  return (
    <Select
      value={state.kind}
      onValueChange={(v) => (state.kind = v as typeof state.kind)}
    >
      <SelectTrigger className="h-8 w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="expense">Expense</SelectItem>
        <SelectItem value="income">Income</SelectItem>
      </SelectContent>
    </Select>
  );
}

function NewSubmit({ state }: { state: NewFormState }) {
  return (
    <Button type="submit" size="icon" disabled={!state.name.trim()}>
      <Plus className="size-4" />
    </Button>
  );
}

function ColorDot({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const s = useLocalObservable(() => ({ open: false }));
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (s.open = !s.open)}
        className={cn(
          "size-6 rounded-full border border-[--color-border]",
          s.open && "ring-2 ring-[--color-ring] ring-offset-1",
        )}
        style={{ backgroundColor: value }}
        aria-label="Pick color"
      />
      {s.open && (
        <div className="absolute left-0 top-7 z-10 flex gap-1 rounded-md border bg-popover p-1 shadow-md">
          {COLORS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => {
                onChange(c);
                s.open = false;
              }}
              className={cn(
                "size-5 rounded-full",
                c === value && "ring-2 ring-[--color-ring]",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
