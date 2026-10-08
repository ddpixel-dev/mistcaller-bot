import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../../src/db/client.ts";
import { testSql } from "../helpers/db.ts";
import { applyMigrations } from "../../src/db/migrate.ts";

let sql: Sql;
const dir = new URL("../../supabase/migrations", import.meta.url).pathname;
const tables = ["guild_settings", "guild_admin_role", "content", "slot", "signup", "vote", "slot_preset", "slot_draft", "attendance"];

before(async () => {
  sql = await testSql(); // runs the safety guard before anything destructive
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

test("schema_migrations has row level security enabled", async () => {
  const [r] = await sql`
    select relrowsecurity from pg_class
    where relnamespace = 'public'::regnamespace and relname = 'schema_migrations'`;
  assert.equal(r!.relrowsecurity, true);
});

test("migration 0014 copies each server's officer role into the admin roles and lets forums be empty", async () => {
  const file = await import("node:fs").then((fs) => fs.readFileSync(new URL("../../supabase/migrations/0014_admin_roles.sql", import.meta.url), "utf8"));
  class Rollback extends Error {}
  let seen: string[] = [];
  await sql.begin(async (tx) => {
    await tx.unsafe("drop table guild_admin_role");
    await tx.unsafe("alter table guild_settings alter column pvp_forum_id set not null, alter column pve_forum_id set not null");
    await tx`insert into guild_settings (guild_id, officer_role_id, pvp_forum_id, pve_forum_id) values ('ga', 'officer-a', 'f1', 'f2'), ('gb', null, 'f3', 'f4')`;
    await tx.unsafe(file);
    seen = (await tx`select guild_id || ':' || role_id as v from guild_admin_role order by 1`).map((r) => r.v as string);
    await tx`insert into guild_settings (guild_id) values ('gc')`; // forum columns are optional now
    throw new Rollback();
  }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
  assert.deepEqual(seen, ["ga:officer-a"]);
});
