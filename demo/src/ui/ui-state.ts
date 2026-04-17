import { makeAutoObservable } from "mobx";
import type { Account, Transaction } from "@/db/entities";

export type Dialog =
  | { kind: "none" }
  | { kind: "newTx" }
  | { kind: "editTx"; tx: Transaction }
  | { kind: "transfer" }
  | { kind: "newAccount" }
  | { kind: "editAccount"; account: Account }
  | { kind: "categories" };

/**
 * Global UI state. Parked in MobX (not React `useState`) so toggling
 * any of it — opening a dialog, flipping the SQL console — re-renders
 * *only* the observer that reads that slot, not the whole component
 * tree. That's the trick: if App doesn't read `ui.dialog`, it never
 * re-renders when a dialog opens; the transaction list stays stable;
 * each row stays stable; nothing cascades.
 */
class UIState {
  dialog: Dialog = { kind: "none" };
  sqlConsoleOpen = false;

  constructor() {
    makeAutoObservable(this);
  }

  close(): void {
    this.dialog = { kind: "none" };
  }
  openNewTx(): void {
    this.dialog = { kind: "newTx" };
  }
  openEditTx(tx: Transaction): void {
    this.dialog = { kind: "editTx", tx };
  }
  openTransfer(): void {
    this.dialog = { kind: "transfer" };
  }
  openNewAccount(): void {
    this.dialog = { kind: "newAccount" };
  }
  openEditAccount(account: Account): void {
    this.dialog = { kind: "editAccount", account };
  }
  openCategories(): void {
    this.dialog = { kind: "categories" };
  }

  toggleSqlConsole(): void {
    this.sqlConsoleOpen = !this.sqlConsoleOpen;
  }
  setSqlConsoleOpen(open: boolean): void {
    this.sqlConsoleOpen = open;
  }
}

export const ui = new UIState();
