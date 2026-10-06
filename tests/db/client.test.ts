import { test } from "node:test";
import assert from "node:assert/strict";
import { sslFor } from "../../src/db/client.ts";

test("sslFor requires TLS for remote hosts and skips it for local ones", () => {
  assert.equal(sslFor("postgres://u:p@aws-0-eu-west-1.pooler.supabase.com:6543/postgres"), "require");
  assert.equal(sslFor("postgres://postgres:test@db:5432/postgres"), false);
  assert.equal(sslFor("postgres://postgres:test@localhost:5432/postgres"), false);
  assert.equal(sslFor("postgres://postgres:test@127.0.0.1:54329/postgres"), false);
  assert.equal(sslFor("not a url"), "require");
});
