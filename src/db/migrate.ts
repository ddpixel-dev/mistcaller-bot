import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Sql } from "./client.ts";

export async function applyMigrations(sql: Sql, dir: string): Promise<string[]> {
  await sql`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;
  await sql`alter table schema_migrations enable row level security`;
  await sql.unsafe(`do $$
  begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
      revoke all on schema_migrations from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      revoke all on schema_migrations from authenticated;
    end if;
  end $$`);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name as string));
  const applied: string[] = [];
  for (const name of files) {
    if (done.has(name)) continue;
    const text = await readFile(join(dir, name), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into schema_migrations (name) values (${name})`;
    });
    applied.push(name);
  }
  return applied;
}
