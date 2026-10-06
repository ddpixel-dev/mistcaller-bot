import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSupabaseUrl } from "../../scripts/supabase-url.ts";
import { classifyAnonStatus } from "../../scripts/anon-tables.ts";

test("normalizeSupabaseUrl strips path, trailing slash, query, hash and whitespace", () => {
  assert.equal(normalizeSupabaseUrl("https://abc.supabase.co/rest/v1/"), "https://abc.supabase.co");
  assert.equal(normalizeSupabaseUrl("https://abc.supabase.co/"), "https://abc.supabase.co");
  assert.equal(normalizeSupabaseUrl("https://abc.supabase.co"), "https://abc.supabase.co");
  assert.equal(normalizeSupabaseUrl("https://ABC.Supabase.CO/rest/v1"), "https://abc.supabase.co");
  assert.equal(normalizeSupabaseUrl("  https://abc.supabase.co/rest/v1/\n"), "https://abc.supabase.co");
  assert.equal(normalizeSupabaseUrl("https://abc.supabase.co/x?select=1#frag"), "https://abc.supabase.co");
});

test("normalizeSupabaseUrl allows http only for localhost and 127.0.0.1", () => {
  assert.equal(normalizeSupabaseUrl("http://localhost:54321/rest/v1"), "http://localhost:54321");
  assert.equal(normalizeSupabaseUrl("http://127.0.0.1:54321/"), "http://127.0.0.1:54321");
  assert.throws(() => normalizeSupabaseUrl("http://evil.example.com"), /https/);
});

test("normalizeSupabaseUrl rejects other schemes and garbage", () => {
  assert.throws(() => normalizeSupabaseUrl("ftp://x"), /https/);
  assert.throws(() => normalizeSupabaseUrl("not a url"), /SUPABASE_URL/);
  assert.throws(() => normalizeSupabaseUrl(""), /SUPABASE_URL/);
});

test("normalizeSupabaseUrl errors never echo secret-looking query values", () => {
  for (const raw of ["http://evil.example.com/?apikey=SECRET", "ftp://x/?apikey=SECRET", "%%%?apikey=SECRET"]) {
    assert.throws(
      () => normalizeSupabaseUrl(raw),
      (e: unknown) => e instanceof Error && !e.message.includes("SECRET"),
    );
  }
});

test("classifyAnonStatus", () => {
  for (const s of [401, 403, 404]) assert.equal(classifyAnonStatus(s), "denied");
  for (const s of [200, 500, 0]) assert.equal(classifyAnonStatus(s), "exposed");
});
