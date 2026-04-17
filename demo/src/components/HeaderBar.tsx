import { observer } from "mobx-react-lite";
import { ArrowLeftRight, Database, Plus, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { stats } from "@/db/orm";

/**
 * App header. Live SELECT counter + entry points for the three
 * top-level mutations (new tx / transfer / manage categories).
 */
export const HeaderBar = observer(function HeaderBar({
  onAddTx,
  onTransfer,
  onCategories,
}: {
  onAddTx: () => void;
  onTransfer: () => void;
  onCategories: () => void;
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
        <Badge
          variant="outline"
          className="gap-1.5 font-normal tabular-nums"
          title={stats.lastSelect}
        >
          <Database className="size-3" />
          <span>{stats.selectCount} SELECTs</span>
        </Badge>
        <Button variant="outline" size="sm" onClick={onCategories}>
          <Tag className="size-4" />
          Categories
        </Button>
        <Button variant="outline" size="sm" onClick={onTransfer}>
          <ArrowLeftRight className="size-4" />
          Transfer
        </Button>
        <Button size="sm" onClick={onAddTx}>
          <Plus className="size-4" />
          Add transaction
        </Button>
      </div>
    </div>
  );
});
