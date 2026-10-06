import { getSql, type Sql } from "../../src/db/client.ts";
import { applyMigrations } from "../../src/db/migrate.ts";

const dir = new URL("../../supabase/migrations", import.meta.url).pathname;
const SAFE_HOSTS = ["localhost", "127.0.0.1", "db"];

export function assertSafeTestDatabaseUrl(
  url: string,
  env: Record<string, string | undefined> = process.env,
): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL; refusing to run destructive tests");
  }
  if (!SAFE_HOSTS.includes(host)) {
    throw new Error(`Refusing destructive tests: host "${host}" is not localhost, 127.0.0.1 or db`);
  }
  if (env.DATABASE_URL !== undefined && url === env.DATABASE_URL) {
    throw new Error(`Refusing destructive tests: TEST_DATABASE_URL equals DATABASE_URL (host "${host}")`);
  }
}

let ready: Promise<Sql> | undefined;

export function testSql(): Promise<Sql> {
  ready ??= (async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("TEST_DATABASE_URL is required");
    assertSafeTestDatabaseUrl(url);
    const sql = getSql(url);
    await applyMigrations(sql, dir);
    return sql;
  })();
  return ready;
}

export async function resetDb(sql: Sql): Promise<void> {
  await sql`truncate table vote, signup, slot, content, guild_settings restart identity cascade`;
}
