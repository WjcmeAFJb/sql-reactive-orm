import type { Orm } from "sql-reactive-orm";
import { Account, Category, Transaction } from "./entities";

/**
 * Compound mutations — anything that can't be expressed as a single
 * `orm.insert / orm.update / orm.delete`. Everything else is inline in
 * the component that cares, because single-call mutations don't need a
 * wrapper.
 *
 * All of these batch their statements inside a BEGIN/COMMIT so the
 * reactive driver fires exactly one notification set per operation —
 * every open query refetches once, every `observer` re-renders once.
 */

export async function transferBetween(
  orm: Orm,
  data: {
    fromAccountId: number;
    toAccountId: number;
    amount: number;
    note: string | null;
    date: string;
  },
): Promise<void> {
  const abs = Math.abs(data.amount);
  const transferId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await orm.driver.run("BEGIN");
  try {
    await orm.insert(Transaction, {
      accountId: data.fromAccountId,
      categoryId: null,
      amount: -abs,
      note: data.note,
      date: data.date,
      transferId,
    });
    await orm.insert(Transaction, {
      accountId: data.toAccountId,
      categoryId: null,
      amount: abs,
      note: data.note,
      date: data.date,
      transferId,
    });
    await orm.driver.run("COMMIT");
  } catch (e) {
    await orm.driver.run("ROLLBACK");
    throw e;
  }
}

/**
 * Deleting a transfer leg removes both legs atomically. Regular
 * transactions go through `orm.delete`.
 */
export async function deleteTransaction(
  orm: Orm,
  tx: Transaction,
): Promise<void> {
  const transferId = await tx.transferId;
  if (transferId != null) {
    await orm.driver.run("BEGIN");
    try {
      await orm.driver.run(
        'DELETE FROM "transactions" WHERE "transferId" = ?',
        [transferId],
      );
      await orm.driver.run("COMMIT");
    } catch (e) {
      await orm.driver.run("ROLLBACK");
      throw e;
    }
    return;
  }
  await orm.delete(tx);
}

/** Delete an account and cascade its transactions. */
export async function deleteAccount(orm: Orm, a: Account): Promise<void> {
  await orm.driver.run("BEGIN");
  try {
    await orm.driver.run(
      'DELETE FROM "transactions" WHERE "accountId" = ?',
      [a.id],
    );
    await orm.driver.run('DELETE FROM "accounts" WHERE "id" = ?', [a.id]);
    await orm.driver.run("COMMIT");
  } catch (e) {
    await orm.driver.run("ROLLBACK");
    throw e;
  }
}

/** Delete a category and null out its transactions' categoryId. */
export async function deleteCategory(orm: Orm, c: Category): Promise<void> {
  await orm.driver.run("BEGIN");
  try {
    await orm.driver.run(
      'UPDATE "transactions" SET "categoryId" = NULL WHERE "categoryId" = ?',
      [c.id],
    );
    await orm.driver.run('DELETE FROM "categories" WHERE "id" = ?', [c.id]);
    await orm.driver.run("COMMIT");
  } catch (e) {
    await orm.driver.run("ROLLBACK");
    throw e;
  }
}
