import postgres from "postgres";

export type Sql = postgres.Sql;

const cache = new Map<string, Sql>();

export function getSql(url: string | undefined = process.env.DATABASE_URL): Sql {
  if (!url) throw new Error("DATABASE_URL is not set");
  let sql = cache.get(url);
  if (!sql) {
    sql = postgres(url, { prepare: false, max: 5, onnotice: () => {} });
    cache.set(url, sql);
  }
  return sql;
}
