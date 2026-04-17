import type { Orm } from "sql-reactive-orm";
import { Account, Category, Transaction } from "./entities";

const ACCOUNTS = [
  { name: "Checking", color: "#3b82f6", initialBalance: 2_500 },
  { name: "Savings", color: "#16a34a", initialBalance: 12_000 },
  { name: "Cash", color: "#f59e0b", initialBalance: 150 },
];

const CATEGORIES = [
  { name: "Salary", color: "#16a34a", kind: "income" },
  { name: "Freelance", color: "#22c55e", kind: "income" },
  { name: "Groceries", color: "#f97316", kind: "expense" },
  { name: "Rent", color: "#ef4444", kind: "expense" },
  { name: "Transport", color: "#8b5cf6", kind: "expense" },
  { name: "Eating out", color: "#ec4899", kind: "expense" },
  { name: "Entertainment", color: "#06b6d4", kind: "expense" },
  { name: "Utilities", color: "#eab308", kind: "expense" },
  { name: "Health", color: "#14b8a6", kind: "expense" },
];

const TX_NOTES = [
  "Weekly shop",
  "Coffee",
  "Lunch",
  "Uber",
  "Gas",
  "Pharmacy",
  "Takeout",
  "Streaming",
  null,
  null,
  null,
];

export async function seed(orm: Orm): Promise<void> {
  const probe = orm.findFirst(Account);
  const existing = await probe;
  probe.dispose();
  if (existing) return;

  const accounts: Account[] = [];
  for (const a of ACCOUNTS) accounts.push(await orm.insert(Account, a));
  const categories: Category[] = [];
  for (const c of CATEGORIES) categories.push(await orm.insert(Category, c));

  // Deterministic PRNG so every reload gets the same dataset.
  let s = 1234567;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;

  const salaryCat = categories[0]!;
  const freelanceCat = categories[1]!;

  // A couple of salary payments this + last month.
  for (let m = 0; m < 3; m++) {
    const d = new Date();
    d.setMonth(d.getMonth() - m);
    d.setDate(1);
    await orm.insert(Transaction, {
      accountId: accounts[0]!.id,
      categoryId: salaryCat.id,
      amount: 3800,
      note: "Monthly salary",
      date: d.toISOString().slice(0, 10),
    });
    if (m === 1) {
      const d2 = new Date(d);
      d2.setDate(15);
      await orm.insert(Transaction, {
        accountId: accounts[0]!.id,
        categoryId: freelanceCat.id,
        amount: 920,
        note: "Side project payment",
        date: d2.toISOString().slice(0, 10),
      });
    }
  }

  // 80 random expenses spread across the last 45 days.
  const expenseCats = categories.filter(
    (c) => c !== salaryCat && c !== freelanceCat,
  );
  for (let i = 0; i < 80; i++) {
    const daysBack = Math.floor(rnd() * 45);
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    const cat = pick(expenseCats);
    const amount =
      -Math.round((3 + rnd() * 180) * 100 + (rnd() < 0.1 ? 50000 : 0)) / 100;
    await orm.insert(Transaction, {
      accountId: pick(accounts).id,
      categoryId: cat.id,
      amount,
      note: pick(TX_NOTES),
      date: d.toISOString().slice(0, 10),
      transferId: null,
    });
  }

  // A couple of transfers so the UI has something to render.
  const transfers = [
    { from: 0, to: 1, amt: 500, day: 3, note: "Move to savings" },
    { from: 1, to: 2, amt: 80, day: 12, note: "ATM withdrawal" },
  ];
  for (const t of transfers) {
    const d = new Date();
    d.setDate(d.getDate() - t.day);
    const transferId = `seed-${t.from}-${t.to}-${t.day}`;
    await orm.insert(Transaction, {
      accountId: accounts[t.from]!.id,
      categoryId: null,
      amount: -t.amt,
      note: t.note,
      date: d.toISOString().slice(0, 10),
      transferId,
    });
    await orm.insert(Transaction, {
      accountId: accounts[t.to]!.id,
      categoryId: null,
      amount: t.amt,
      note: t.note,
      date: d.toISOString().slice(0, 10),
      transferId,
    });
  }
}
