import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { ANON_PROBE_TABLES } from "../../scripts/anon-tables.ts";

test("check-anon probes every table created by the migrations plus schema_migrations", () => {
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const sql = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
  const created = [...sql.matchAll(/create table\s+(?:if not exists\s+)?(\w+)/gi)].map((m) => m[1]!);
  assert.deepEqual([...ANON_PROBE_TABLES].sort(), [...created, "schema_migrations"].sort());
});
