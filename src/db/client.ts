import postgres from "postgres";

export type Sql = postgres.Sql;

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "db"];

export function sslFor(url: string): "require" | false {
  try {
    return LOCAL_HOSTS.includes(new URL(url).hostname) ? false : "require";
  } catch {
    return "require";
  }
}

const cache = new Map<string, Sql>();

export function getSql(url: string | undefined = process.env.DATABASE_URL): Sql {
  if (!url) throw new Error("DATABASE_URL is not set");
  let sql = cache.get(url);
  if (!sql) {
    sql = postgres(url, {
      prepare: false,
      max: 5,
      onnotice: () => {},
      ssl: sslFor(url),
      connect_timeout: 5,
      idle_timeout: 20,
    });
    cache.set(url, sql);
  }
  return sql;
}
