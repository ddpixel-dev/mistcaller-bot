import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBombersCap } from "../../src/domain/bombers.ts";

const ERR = "Bombers must be a number from 1 to 20, or empty for no Bombers.";

test("an empty cap means no Bombers", () => {
  assert.deepEqual(parseBombersCap(""), { ok: true, value: null });
  assert.deepEqual(parseBombersCap("   "), { ok: true, value: null });
});

test("1 to 20 is accepted, trimmed", () => {
  assert.deepEqual(parseBombersCap(" 7 "), { ok: true, value: 7 });
  assert.deepEqual(parseBombersCap("1"), { ok: true, value: 1 });
  assert.deepEqual(parseBombersCap("20"), { ok: true, value: 20 });
});

test("anything else is the error", () => {
  for (const t of ["0", "21", "-3", "2.5", "abc", "5 bombers", "1e1"]) assert.deepEqual(parseBombersCap(t), { ok: false, error: ERR }, t);
});
