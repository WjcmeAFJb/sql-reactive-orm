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
}
