import {
  Entity,
  belongsTo,
  hasMany,
  integer,
  primary,
  real,
  text,
  type EntitySchema,
} from "sql-reactive-orm";

/**
 * Everything a component needs to render a money tracker is declared
 * here once. No per-query fragment, no manual selection set, no
 * memoization primitives — components just read `account.name`,
 * `tx.category`, `category.color` and the ORM figures out what to load.
 *
 * Mutations that don't fit a single `orm.insert / update / delete`
 * call (cascades, transfers) live as methods on the entities, so the
 * rest of the app talks to entities as plain JS objects:
 *
 *   await tx.remove()
 *   await account.remove()
 *   await checking.transferTo(savings, { amount: 100, … })
 *
 * Each method batches its statements through `this._orm.driver` inside
 * a BEGIN/COMMIT; the reactive driver wrapper fans out a single
 * invalidation at commit time.
 */

export class Account extends Entity {
  static schema: EntitySchema = {
    name: "Account",
    table: "accounts",
    primaryKey: "id",
    fields: {
      id: primary(),
      name: text(),
      color: text(),
      initialBalance: real({ default: 0 }),
    },
    relations: {
      transactions: hasMany(() => Transaction, "accountId"),
    },
  };
  declare id: number;
  declare name: Promise<string>;
  declare color: Promise<string>;
  declare initialBalance: Promise<number>;
  declare transactions: Promise<Transaction[]>;

  /** Delete this account and cascade to its transactions. */
  async remove(): Promise<void> {
    await this._orm.transaction(async () => {
      const d = this._orm.driver;
      await d.run('DELETE FROM "transactions" WHERE "accountId" = ?', [this.id]);
      await d.run('DELETE FROM "accounts" WHERE "id" = ?', [this.id]);
    });
  }

  /**
   * Move money from this account to `to`. Inserts two linked
   * transactions (opposite signs, shared `transferId`). The enclosing
   * `transaction()` both atomicises the pair *and* serialises it with
   * any other in-flight `transferTo` / `remove` — SQLite's single
   * transaction slot stays well-defined under concurrent callers.
   */
  async transferTo(
    to: Account,
    data: { amount: number; note: string | null; date: string },
  ): Promise<void> {
    const abs = Math.abs(data.amount);
    const transferId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await this._orm.transaction(async () => {
      await this._orm.insert(Transaction, {
        accountId: this.id,
        categoryId: null,
        amount: -abs,
        note: data.note,
        date: data.date,
        transferId,
      });
      await this._orm.insert(Transaction, {
        accountId: to.id,
        categoryId: null,
        amount: abs,
        note: data.note,
        date: data.date,
        transferId,
      });
    });
  }
}

export class Category extends Entity {
  static schema: EntitySchema = {
    name: "Category",
    table: "categories",
    primaryKey: "id",
    fields: {
      id: primary(),
      name: text(),
      color: text(),
      kind: text(), // "income" | "expense"
    },
    relations: {
      transactions: hasMany(() => Transaction, "categoryId"),
    },
  };
  declare id: number;
  declare name: Promise<string>;
  declare color: Promise<string>;
  declare kind: Promise<"income" | "expense">;
  declare transactions: Promise<Transaction[]>;

  /** Delete this category. Transactions using it become uncategorized. */
  async remove(): Promise<void> {
    await this._orm.transaction(async () => {
      const d = this._orm.driver;
      await d.run(
        'UPDATE "transactions" SET "categoryId" = NULL WHERE "categoryId" = ?',
        [this.id],
      );
      await d.run('DELETE FROM "categories" WHERE "id" = ?', [this.id]);
    });
  }
}

export class Transaction extends Entity {
  static schema: EntitySchema = {
    name: "Transaction",
    table: "transactions",
    primaryKey: "id",
    fields: {
      id: primary(),
      accountId: integer(),
      categoryId: integer({ nullable: true }),
      amount: real(),
      note: text({ nullable: true }),
      date: text(),
      // When non-null, this row is one leg of a two-row transfer between
      // accounts. Both legs share the same `transferId`.
      transferId: text({ nullable: true }),
    },
    relations: {
      account: belongsTo(() => Account, "accountId"),
      category: belongsTo(() => Category, "categoryId"),
    },
  };
  declare id: number;
  declare accountId: Promise<number>;
  declare categoryId: Promise<number | null>;
  declare amount: Promise<number>;
  declare note: Promise<string | null>;
  declare date: Promise<string>;
  declare transferId: Promise<string | null>;
  declare account: Promise<Account>;
  declare category: Promise<Category | null>;

  /**
   * Delete this transaction. If it's one leg of a transfer, both legs
   * are removed atomically so we don't leave an orphan.
   */
  async remove(): Promise<void> {
    const transferId = await this.transferId;
    if (transferId == null) {
      await this._orm.delete(this);
      return;
    }
    await this._orm.transaction(async () => {
      await this._orm.driver.run(
        'DELETE FROM "transactions" WHERE "transferId" = ?',
        [transferId],
      );
    });
  }
}
