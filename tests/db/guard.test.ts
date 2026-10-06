import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSafeTestDatabaseUrl } from "../helpers/db.ts";

test("rejects a remote host", () => {
  assert.throws(() => assertSafeTestDatabaseUrl("postgres://u:p@abc.supabase.co:6543/postgres", {}));
});

test("rejects a URL equal to DATABASE_URL even on host db", () => {
  const u = "postgres://postgres:test@db:5432/postgres";
  assert.throws(() => assertSafeTestDatabaseUrl(u, { DATABASE_URL: u }));
});

test("rejects garbage", () => {
  assert.throws(() => assertSafeTestDatabaseUrl("not a url", {}));
});

test("accepts compose and localhost URLs", () => {
  assertSafeTestDatabaseUrl("postgres://postgres:test@db:5432/postgres", {});
  assertSafeTestDatabaseUrl("postgres://postgres:test@localhost:54329/postgres", {});
});

test("messages do not leak credentials", () => {
  for (const u of ["postgres://u:p@abc.supabase.co:6543/postgres", "postgres://user:hunter2@garbage host/x"]) {
    try {
      assertSafeTestDatabaseUrl(u, {});
      assert.fail("should throw");
    } catch (e) {
      const m = (e as Error).message;
      assert.ok(!m.includes("p@") && !m.includes("hunter2") && !m.includes("user:"), m);
    }
  }
});
