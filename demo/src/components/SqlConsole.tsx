import { observer } from "mobx-react-lite";
import { useRef, useState, type KeyboardEvent } from "react";
import { ChevronsDown, Play, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOrm } from "@/db/orm-context";

type SqlResult =
  | { kind: "idle" }
  | { kind: "ok"; changes: number; lastInsertRowid: number | bigint }
  | { kind: "rows"; rows: Record<string, unknown>[] }
  | { kind: "error"; message: string };

const SAMPLES: { label: string; sql: string }[] = [
  {
    label: "Top 10 largest expenses",
    sql: 'SELECT date, amount, note, accountId, categoryId\n  FROM "transactions"\n ORDER BY amount ASC\n LIMIT 10;',
  },
  {
    label: "Spend by category (30d)",
    sql: "SELECT c.name, ROUND(SUM(t.amount), 2) AS total\n  FROM transactions t\n  JOIN categories  c ON c.id = t.categoryId\n WHERE t.date >= date('now','-30 days') AND t.amount < 0\n GROUP BY c.id\n ORDER BY total ASC;",
  },
  {
    label: "Bulk-update: tag all uncategorised",
    sql: "-- Mutations go through orm.driver.run → the page refetches automatically.\nUPDATE transactions\n   SET categoryId = (SELECT id FROM categories WHERE name = 'Groceries' LIMIT 1)\n WHERE categoryId IS NULL;",
  },
  {
    label: "Delete ATM micro-fees",
    sql: 'DELETE FROM "transactions" WHERE amount BETWEEN -1 AND 0;',
  },
];

export const SqlConsole = observer(function SqlConsole() {
  const orm = useOrm();
  const [open, setOpen] = useState(false);
  const [sql, setSql] = useState(SAMPLES[0]!.sql);
  const [result, setResult] = useState<SqlResult>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function run(): Promise<void> {
    const trimmed = sql.trim().replace(/;+\s*$/, "");
    if (!trimmed) return;
    setBusy(true);
    try {
      if (/^(SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(trimmed)) {
        const rows = await orm.driver.all<Record<string, unknown>>(trimmed);
        setResult({ kind: "rows", rows });
      } else {
        const res = await orm.driver.run(trimmed);
        setResult({
          kind: "ok",
          changes: res.changes,
          lastInsertRowid: res.lastInsertRowid,
        });
      }
    } catch (e) {
      setResult({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void run();
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const el = textareaRef.current!;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = sql.slice(0, start) + "  " + sql.slice(end);
      setSql(next);
      queueMicrotask(() => {
        el.selectionStart = el.selectionEnd = start + 2;
      });
    }
  }

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 shadow-lg"
        size="sm"
      >
        <Terminal className="size-4" />
        SQL
      </Button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[680px] max-w-[calc(100vw-2rem)] max-h-[80vh] flex-col rounded-lg border border-[--color-border] bg-background shadow-2xl">
      <div className="flex items-center justify-between border-b border-[--color-border] px-3 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="size-4" />
          <div className="text-sm font-medium">SQL console</div>
          <div className="text-xs text-muted-foreground">
            routed through <code>orm.driver</code> — mutations auto-refresh the
            UI
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
          <ChevronsDown className="size-4" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[--color-border] px-3 py-2">
        {SAMPLES.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => setSql(s.sql)}
            className="rounded border border-[--color-border] bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {s.label}
          </button>
        ))}
      </div>

      <textarea
        ref={textareaRef}
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        className="h-40 resize-none bg-muted/20 p-3 font-mono text-[12px] leading-relaxed outline-none"
      />

      <div className="flex items-center justify-between border-t border-[--color-border] px-3 py-2">
        <div className="text-[11px] text-muted-foreground">
          <kbd className="rounded border border-[--color-border] bg-muted px-1 py-0.5 text-[10px]">
            ⌘/Ctrl
          </kbd>{" "}
          +{" "}
          <kbd className="rounded border border-[--color-border] bg-muted px-1 py-0.5 text-[10px]">
            Enter
          </kbd>{" "}
          to run
        </div>
        <Button size="sm" onClick={() => void run()} disabled={busy}>
          <Play className="size-3.5" />
          {busy ? "Running…" : "Run"}
        </Button>
      </div>

      <div className="min-h-20 overflow-auto border-t border-[--color-border]">
        <ResultView result={result} />
      </div>
    </div>
  );
});

function ResultView({ result }: { result: SqlResult }): React.ReactElement {
  if (result.kind === "idle") {
    return (
      <div className="px-3 py-4 text-xs text-muted-foreground">
        Results appear here. Try a SELECT to preview rows, or run an UPDATE and
        watch the cards above refresh on their own.
      </div>
    );
  }

  if (result.kind === "error") {
    return (
      <pre className="whitespace-pre-wrap px-3 py-3 text-xs text-destructive">
        {result.message}
      </pre>
    );
  }

  if (result.kind === "ok") {
    return (
      <div className="px-3 py-3 text-xs">
        <span className="font-medium">✓ {result.changes}</span> row
        {result.changes === 1 ? "" : "s"} affected
        {result.changes > 0 && (
          <span className="text-muted-foreground">
            {" "}
            · lastInsertRowid ={" "}
            <code className="tabular-nums">
              {String(result.lastInsertRowid)}
            </code>
          </span>
        )}
      </div>
    );
  }

  const rows = result.rows;
  if (rows.length === 0) {
    return (
      <div className="px-3 py-3 text-xs text-muted-foreground">
        Query returned 0 rows.
      </div>
    );
  }
  const cols = Object.keys(rows[0]!);

  return (
    <div className="overflow-auto max-h-[40vh]">
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-3 py-1.5 text-left font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={cn("border-t border-[--color-border]/60")}>
              {cols.map((c) => (
                <td
                  key={c}
                  className="px-3 py-1 tabular-nums text-muted-foreground"
                >
                  {formatCell(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return JSON.stringify(v);
}
