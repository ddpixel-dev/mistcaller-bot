import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_MASSING, parseMassing } from "../../src/domain/massing.ts";

test("Massing at: empty means none; text is cleaned; a channel mention is kept; over 100 characters is an error", () => {
  assert.deepEqual(parseMassing(""), { ok: true, value: null });
  assert.deepEqual(parseMassing("   \n "), { ok: true, value: null });
  assert.deepEqual(parseMassing("  Caerleon \n bank\t"), { ok: true, value: "Caerleon bank" });
  assert.deepEqual(parseMassing("Meet in <#123456789012345678>"), { ok: true, value: "Meet in <#123456789012345678>" });
  assert.equal(parseMassing("a".repeat(MAX_MASSING)).ok, true);
  assert.deepEqual(parseMassing("a".repeat(MAX_MASSING + 1)), { ok: false, error: "Massing at can be at most 100 characters." });
});
