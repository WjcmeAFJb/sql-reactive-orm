import { Account, Category, Transaction } from "./src/db/entities";

/**
 * Single source of truth for the demo's schema. `pnpm codegen` reads
 * this and emits `src/generated/schema.sql` + `src/generated/db.ts`.
 */
export default {
  entities: [Account, Category, Transaction],
};
