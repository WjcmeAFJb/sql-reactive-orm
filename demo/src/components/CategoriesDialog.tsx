import { observer } from "mobx-react-lite";
import { use, useState, type FormEvent } from "react";
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
import { useOrm } from "@/db/orm-context";
import { deleteCategory } from "@/db/actions";

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

export const CategoriesDialog = observer(function CategoriesDialog() {
  const orm = useOrm();
  const categories = use(orm.findAll(Category, { orderBy: "id" }));
  const [editingId, setEditingId] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <NewCategoryRow />
      <div className="border-t pt-2">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground pb-2">
          Existing ({categories.length})
        </div>
        <div className="max-h-[360px] overflow-y-auto -mx-6 px-6">
          {categories.map((c) =>
            editingId === c.id ? (
              <EditCategoryRow
                key={c.id}
                category={c}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <CategoryRow
                key={c.id}
                category={c}
                onEdit={() => setEditingId(c.id)}
                onDelete={() => void deleteCategory(orm, c)}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
});

const CategoryRow = observer(function CategoryRow({
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
});

const EditCategoryRow = observer(function EditCategoryRow({
  category,
  onDone,
}: {
  category: Category;
  onDone: () => void;
}) {
  const orm = useOrm();
  const [name, setName] = useState(use(category.name) as string);
  const [color, setColor] = useState(use(category.color) as string);
  const [kind, setKind] = useState<"income" | "expense">(
    use(category.kind) as "income" | "expense",
  );

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim()) return;
    await orm.update(category, { name: name.trim(), color, kind });
    onDone();
  }

  return (
    <form onSubmit={save} className="flex items-center gap-2 py-1.5">
      <ColorDot value={color} onChange={setColor} />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-8 flex-1"
        autoFocus
      />
      <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
        <SelectTrigger className="h-8 w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="expense">Expense</SelectItem>
          <SelectItem value="income">Income</SelectItem>
        </SelectContent>
      </Select>
      <Button type="submit" size="icon" variant="ghost">
        <Check className="size-4" />
      </Button>
      <Button type="button" size="icon" variant="ghost" onClick={onDone}>
        <X className="size-4" />
      </Button>
    </form>
  );
});

const NewCategoryRow = observer(function NewCategoryRow() {
  const orm = useOrm();
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]!);
  const [kind, setKind] = useState<"income" | "expense">("expense");

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await orm.insert(Category, { name: trimmed, color, kind });
    setName("");
  }

  return (
    <form
      onSubmit={save}
      className="flex items-center gap-2 rounded-md border border-dashed p-2"
    >
      <ColorDot value={color} onChange={setColor} />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New category name"
        className="h-8 flex-1"
      />
      <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
        <SelectTrigger className="h-8 w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="expense">Expense</SelectItem>
          <SelectItem value="income">Income</SelectItem>
        </SelectContent>
      </Select>
      <Button type="submit" size="icon" disabled={!name.trim()}>
        <Plus className="size-4" />
      </Button>
    </form>
  );
});

function ColorDot({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        className={cn(
          "size-6 rounded-full border border-[--color-border]",
          open && "ring-2 ring-[--color-ring] ring-offset-1",
        )}
        style={{ backgroundColor: value }}
        aria-label="Pick color"
      />
      {open && (
        <div className="absolute left-0 top-7 z-10 flex gap-1 rounded-md border bg-popover p-1 shadow-md">
          {COLORS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => {
                onChange(c);
                setOpen(false);
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
