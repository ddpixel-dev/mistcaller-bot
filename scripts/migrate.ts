import { getSql } from "../src/db/client.ts";
import { applyMigrations } from "../src/db/migrate.ts";

const sql = getSql();
try {
  const dir = new URL("../supabase/migrations", import.meta.url).pathname;
  const applied = await applyMigrations(sql, dir);
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date");
} finally {
  await sql.end();
}
