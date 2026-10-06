import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../src/db/client.ts";
import { applyMigrations } from "../../src/db/migrate.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
const sql = getSql(url);
const dir = new URL("../../supabase/migrations", import.meta.url).pathname;
const tables = ["guild_settings", "content", "slot", "signup", "vote"];

before(async () => {
  await sql.unsafe("drop schema public cascade; create schema public;");
});
after(async () => {
  await sql.end();
});

async function sqlState(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

test("applyMigrations creates all tables, second call applies nothing", async () => {
  const first = await applyMigrations(sql, dir);
  assert.ok(first.length >= 1);
  const rows = await sql`select tablename from pg_tables where schemaname = 'public'`;
  const names = rows.map((r) => r.tablename);
  for (const t of tables) assert.ok(names.includes(t), `missing ${t}`);
  assert.deepEqual(await applyMigrations(sql, dir), []);
});

test("one signed signup per slot; waitlist allowed", async () => {
  const [c] = await sql`
    insert into content (guild_id, thread_id, type) values ('g', 't', 'pvp') returning id`;
  const [s] = await sql`
    insert into slot (guild_id, content_id, position, role, weapon)
    values ('g', ${c!.id}, 1, 'tank', 'mace') returning id`;
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status)
    values ('g', ${c!.id}, 'u1', ${s!.id}, 'signed')`;
  const code = await sqlState(
    sql`insert into signup (guild_id, content_id, user_id, slot_id, status)
      values ('g', ${c!.id}, 'u2', ${s!.id}, 'signed')`,
  );
  assert.equal(code, "23505");
  await sql`insert into signup (guild_id, content_id, user_id, slot_id, status)
    values ('g', ${c!.id}, 'u3', ${s!.id}, 'waitlist')`;
});

test("row level security enabled on every app table", async () => {
  const rows = await sql`
    select relname, relrowsecurity from pg_class
    where relnamespace = 'public'::regnamespace and relname = any(${tables})`;
  assert.equal(rows.length, tables.length);
  for (const r of rows) assert.equal(r.relrowsecurity, true, r.relname);
});
