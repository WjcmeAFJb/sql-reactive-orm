import { makeAutoObservable, runInAction } from "mobx";
import type { Orm, Query } from "sql-reactive-orm";
import { Account, Category, Transaction } from "./entities";

export type LoadingMode = "lazy" | "eager";

/**
 * The app's one piece of shared state: the open queries and the
 * `loadingMode` that decides whether relations are eagerly joined.
 *
 * `loadingMode` is the knob the demo uses to showcase progressive
 * optimisation. Flipping it rebuilds the queries with or without a
 * `with` clause — the React components don't change at all.
 */
export class AppState {
  loadingMode: LoadingMode = "eager";
  transactions!: Query<Transaction[]>;
  accounts!: Query<Account[]>;
  categories!: Query<Category[]>;

  constructor(public readonly orm: Orm) {
    makeAutoObservable<this, "orm">(this, { orm: false });
    this.rebuildQueries();
  }

  setLoadingMode(mode: LoadingMode): void {
    if (mode === this.loadingMode) return;
    this.loadingMode = mode;
    // Drop every cached row + relation so the new mode actually plays
    // out from scratch — without this, lazy mode would still see the
    // relations the previous eager pass populated.
    this.orm.clearCaches();
    this.rebuildQueries();
  }

  async addTransaction(data: {
    accountId: number;
    categoryId: number | null;
    amount: number;
    note: string | null;
    date: string;
  }): Promise<Transaction> {
    return this.orm.insert(Transaction, data);
  }

  async deleteTransaction(tx: Transaction): Promise<void> {
    await this.orm.delete(tx);
  }

  private rebuildQueries(): void {
    this.transactions?.dispose();
    this.accounts?.dispose();
    this.categories?.dispose();
    const eager = this.loadingMode === "eager";
    runInAction(() => {
      this.transactions = this.orm.findAll(Transaction, {
        orderBy: [
          ["date", "desc"],
          ["id", "desc"],
        ],
        with: eager ? { account: true, category: true } : undefined,
      });
      this.accounts = this.orm.findAll(Account, {
        orderBy: "id",
        with: eager ? { transactions: true } : undefined,
      });
      this.categories = this.orm.findAll(Category, { orderBy: "id" });
    });
  }
}

let _state: AppState | null = null;
export function getState(orm: Orm): AppState {
  if (!_state) _state = new AppState(orm);
  return _state;
}
