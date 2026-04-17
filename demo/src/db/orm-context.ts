import { createContext, useContext } from "react";
import type { Orm } from "sql-reactive-orm";

const OrmContext = createContext<Orm | null>(null);

export const OrmProvider = OrmContext.Provider;

export function useOrm(): Orm {
  const orm = useContext(OrmContext);
  if (!orm) throw new Error("useOrm() used outside <OrmProvider>");
  return orm;
}
