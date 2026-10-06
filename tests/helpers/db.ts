import { getSql, type Sql } from "../../src/db/client.ts";
import { applyMigrations } from "../../src/db/migrate.ts";

const dir = new URL("../../supabase/migrations", import.meta.url).pathname;
let ready: Promise<Sql> | undefined;

export function testSql(): Promise<Sql> {
  ready ??= (async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("TEST_DATABASE_URL is required");
    const sql = getSql(url);
    await applyMigrations(sql, dir);
    return sql;
  })();
  return ready;
}

export async function resetDb(sql: Sql): Promise<void> {
  await sql`truncate table vote, signup, slot, content, guild_settings restart identity cascade`;
}
