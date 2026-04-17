import type { Driver, RunResult } from "./driver.js";

/**
 * Given any SQL string, return the set of table names affected by mutation
 * statements (INSERT / UPDATE / DELETE / REPLACE / DROP TABLE / ALTER
 * TABLE). SELECTs and other read-only statements return the empty set.
 *
 * The parser is intentionally simple: it strips `--` and block comments,
 * then uses anchored keyword regexes to pull table names out. It
 * recognises SQLite's standard `"name"` double-quoted identifiers, MySQL
 * backticks, SQL Server brackets, and bare identifiers — the three common
 * quoting styles most SQLite-flavoured drivers emit.
 *
 * This is a heuristic, not a full SQL parser. It will miss pathological
 * cases (dynamic SQL concatenation, a DROP TABLE name that is a keyword,
 * triggers that cascade to other tables) — for those callers should use
 * `orm.invalidate(...)` explicitly. The heuristic is correct for
 * everything that a hand-written `UPDATE users SET …` looks like, which
 * is the entire target use case.
 */
export function detectMutatedTables(sql: string): Set<string> {
  const out = new Set<string>();
  // Strip comments so they don't seed false matches.
  const stripped = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const pattern of MUTATION_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(stripped)) !== null) {
      // Table name sits in the first-defined capture (quoted variants
      // give different groups) — union them.
      const name = m[2] ?? m[3] ?? m[4] ?? m[5];
      if (name) out.add(name);
    }
  }
  return out;
}

// Each pattern has the same shape: <keyword> <optional OR-clause>
// <table-identifier in one of four styles>. The union capture group
// design means we only ever see one of groups 2..5 populated per match.
const IDENT = String.raw`("([^"]+)"|\x60([^\x60]+)\x60|\[([^\]]+)\]|([A-Za-z_][\w$]*))`;
const MUTATION_PATTERNS: RegExp[] = [
  new RegExp(`\\bINSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${IDENT}`, "gi"),
  new RegExp(`\\bUPDATE\\s+(?:OR\\s+\\w+\\s+)?${IDENT}`, "gi"),
  new RegExp(`\\bDELETE\\s+FROM\\s+${IDENT}`, "gi"),
  new RegExp(`\\bREPLACE\\s+INTO\\s+${IDENT}`, "gi"),
  new RegExp(`\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${IDENT}`, "gi"),
  new RegExp(`\\bALTER\\s+TABLE\\s+${IDENT}`, "gi"),
];

const TXN_BEGIN = /^\s*(?:BEGIN|SAVEPOINT)\b/i;
const TXN_COMMIT = /^\s*(?:COMMIT|END|RELEASE)\b/i;
const TXN_ROLLBACK = /^\s*ROLLBACK\b/i;

/**
 * Wrap a raw driver so every mutating statement that passes through it
 * fires `onMutation` with the set of affected tables. The wrapper also
 * batches mutations inside `BEGIN`/`COMMIT`: notifications are held until
 * the commit lands (and dropped entirely on `ROLLBACK`), so a single
 * transaction of N writes causes at most one refetch per table, not N.
 *
 * The wrapper is transparent on reads — `all()` is a direct delegate —
 * and exec is handled like run for the side of mutation detection. Pass
 * the result in as `orm.driver` and every raw SQL path, including an
 * Entity method that calls `this._orm.driver.run('UPDATE …')` or an
 * unrelated query-builder library that was handed the same driver,
 * participates in reactivity automatically.
 */
export function wrapReactive(
  driver: Driver,
  onMutation: (tables: Set<string>) => void,
): Driver {
  const deferred = new Set<string>();
  let depth = 0;

  const notifyOrDefer = (sql: string): void => {
    const head = sql.trimStart();
    if (TXN_BEGIN.test(head)) {
      depth++;
      return;
    }
    if (TXN_ROLLBACK.test(head)) {
      depth = Math.max(0, depth - 1);
      if (depth === 0) deferred.clear();
      return;
    }
    if (TXN_COMMIT.test(head)) {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && deferred.size > 0) {
        const flush = new Set(deferred);
        deferred.clear();
        onMutation(flush);
      }
      return;
    }
    const tables = detectMutatedTables(sql);
    if (tables.size === 0) return;
    if (depth > 0) {
      for (const t of tables) deferred.add(t);
      return;
    }
    onMutation(tables);
  };

  const wrapped: Driver = {
    exec: async (sql: string): Promise<void> => {
      await driver.exec(sql);
      notifyOrDefer(sql);
    },
    run: async (
      sql: string,
      params?: readonly unknown[],
    ): Promise<RunResult> => {
      const result = await driver.run(sql, params);
      notifyOrDefer(sql);
      return result;
    },
    all: <T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<T[]> => driver.all<T>(sql, params),
  };
  if (driver.close) wrapped.close = () => driver.close!();
  return wrapped;
}
