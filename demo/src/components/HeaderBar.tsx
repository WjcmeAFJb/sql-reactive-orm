import { observer } from "mobx-react-lite";
import { Plus, Zap, TurtleIcon, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { stats } from "@/db/orm";
import type { AppState, LoadingMode } from "@/db/state";

/**
 * App header. Hosts:
 *   - the loading-mode toggle (the "progressive optimisation" knob),
 *   - the live SELECT counter so the user can see round-trips change,
 *   - the "add transaction" trigger.
 */
export const HeaderBar = observer(function HeaderBar({
  state,
  onAdd,
}: {
  state: AppState;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[--color-border] bg-background px-6 py-4">
      <div>
        <div className="text-lg font-semibold leading-tight">Money Tracker</div>
        <div className="text-xs text-muted-foreground">
          <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
            sql-reactive-orm
          </code>{" "}
          demo · sql.js in the browser
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <ModeToggle
          value={state.loadingMode}
          onChange={(m) => state.setLoadingMode(m)}
        />
        <Badge
          variant="outline"
          className="gap-1.5 font-normal tabular-nums"
          title={stats.lastSelect}
        >
          <Database className="size-3" />
          <span>{stats.selectCount} SELECTs</span>
        </Badge>
        <Button onClick={onAdd}>
          <Plus className="size-4" />
          Add transaction
        </Button>
      </div>
    </div>
  );
});

function ModeToggle({
  value,
  onChange,
}: {
  value: LoadingMode;
  onChange: (v: LoadingMode) => void;
}): React.ReactElement {
  return (
    <div
      role="radiogroup"
      className="inline-flex rounded-md border border-[--color-border] bg-muted/40 p-0.5 text-xs"
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === "eager"}
        onClick={() => onChange("eager")}
        className={
          "inline-flex items-center gap-1 rounded px-2.5 py-1 transition-colors " +
          (value === "eager"
            ? "bg-background shadow font-medium"
            : "text-muted-foreground hover:text-foreground")
        }
      >
        <Zap className="size-3" /> Eager
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === "lazy"}
        onClick={() => onChange("lazy")}
        className={
          "inline-flex items-center gap-1 rounded px-2.5 py-1 transition-colors " +
          (value === "lazy"
            ? "bg-background shadow font-medium"
            : "text-muted-foreground hover:text-foreground")
        }
      >
        <TurtleIcon className="size-3" /> Lazy
      </button>
    </div>
  );
}
