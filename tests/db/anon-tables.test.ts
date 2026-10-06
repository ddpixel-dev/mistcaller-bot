import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ANON_PROBE_TABLES } from "../../scripts/anon-tables.ts";

test("check-anon probes every table created by the migrations plus schema_migrations", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/0001_core.sql", import.meta.url), "utf8");
  const created = [...sql.matchAll(/create table\s+(?:if not exists\s+)?(\w+)/gi)].map((m) => m[1]!);
  assert.deepEqual([...ANON_PROBE_TABLES].sort(), [...created, "schema_migrations"].sort());
});
