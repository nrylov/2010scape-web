import type { SQL } from "bun";

// Bun's SQLite adapter uses one connection and cannot overlap begin() calls.
// PostgreSQL retains its normal pool concurrency and database row locking.
const flights = new WeakMap<SQL, Promise<unknown>>();
export function sqlTransaction<const T>(sql: SQL, work: SQL.TransactionContextCallback<T>): Promise<SQL.ContextCallbackResult<T>> {
  if (sql.options.adapter !== "sqlite") return sql.begin(work);
  const result = (flights.get(sql) ?? Promise.resolve()).then(() => sql.begin(work));
  flights.set(sql, result.then(() => undefined, () => undefined));
  return result;
}
