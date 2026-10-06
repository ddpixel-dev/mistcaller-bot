import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTier, formatTier, parseSlots, parseUtcStart, parseTitle, parseNotes } from "../../src/domain/parse.ts";

function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  return (r as { ok: true; value: T }).value;
}
function err(r: { ok: boolean; error?: string }): string {
  assert.equal(r.ok, false);
  return r.error as string;
}

test("parseTier single", () => {
  assert.deepEqual(ok(parseTier("T5.3")), { min: { tier: 5, enchant: 3 }, max: null });
  assert.deepEqual(ok(parseTier("t5.3")), { min: { tier: 5, enchant: 3 }, max: null });
});

test("parseTier ranges", () => {
  for (const s of ["T5.3-T7.0", "T5.3 - T7.0", "T5.3–T7.0"]) {
    assert.deepEqual(ok(parseTier(s)), { min: { tier: 5, enchant: 3 }, max: { tier: 7, enchant: 0 } }, s);
  }
});

test("parseTier errors mention the example", () => {
  for (const s of ["T7.0-T5.3", "T9.0", "T5.5", "5.3", "T5", ""]) {
    assert.ok(err(parseTier(s)).includes("T5.3"), s);
  }
});

test("formatTier", () => {
  assert.equal(formatTier({ min: { tier: 5, enchant: 3 }, max: null }), "T5.3");
  assert.equal(formatTier({ min: { tier: 5, enchant: 3 }, max: { tier: 7, enchant: 0 } }), "T5.3–T7.0");
});

test("parseSlots happy path", () => {
  assert.deepEqual(ok(parseSlots("Tank - Axe\nDPS-Longbow\n\nHealer – Holy")), [
    { role: "Tank", weapon: "Axe" },
    { role: "DPS", weapon: "Longbow" },
    { role: "Healer", weapon: "Holy" },
  ]);
  assert.deepEqual(ok(parseSlots("Tank - Great Axe")), [{ role: "Tank", weapon: "Great Axe" }]);
});

test("parseSlots errors", () => {
  assert.ok(err(parseSlots("Tank - Axe\nDPS Longbow")).includes("line 2"));
  const many = Array.from({ length: 21 }, (_, i) => `R${i} - W`).join("\n");
  assert.ok(err(parseSlots(many)).length > 0);
  assert.ok(err(parseSlots("")).length > 0);
  assert.ok(err(parseSlots("   \n\n")).length > 0);
  assert.ok(err(parseSlots(`${"a".repeat(31)} - Axe`)).length > 0);
  assert.ok(err(parseSlots(`Tank - ${"a".repeat(41)}`)).length > 0);
  ok(parseSlots(`${"a".repeat(30)} - ${"b".repeat(40)}`));
  ok(parseSlots(Array.from({ length: 20 }, (_, i) => `R${i} - W`).join("\n")));
});

test("parseUtcStart", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  assert.equal(ok(parseUtcStart("2026-10-07 18:00", now)).toISOString(), "2026-10-07T18:00:00.000Z");
  assert.equal(ok(parseUtcStart("2026-10-07 18:00 UTC", now)).toISOString(), "2026-10-07T18:00:00.000Z");
  for (const s of ["2026-02-30 18:00", "2026-10-07 25:00", "2026-10-7 18:00", "2026-10-05 18:00", "2026-10-06 12:00"]) {
    assert.ok(err(parseUtcStart(s, now)).includes("2026-10-07 18:00"), s);
  }
});

test("parseTitle", () => {
  assert.equal(ok(parseTitle("  Hello  ")), "Hello");
  assert.ok(err(parseTitle("   ")).length > 0);
  assert.ok(err(parseTitle("a".repeat(101))).length > 0);
  assert.equal(ok(parseTitle("a".repeat(100))).length, 100);
});

test("parseNotes", () => {
  assert.equal(ok(parseNotes("")), null);
  assert.equal(ok(parseNotes("  \n ")), null);
  assert.equal(ok(parseNotes(" hi ")), "hi");
  assert.ok(err(parseNotes("a".repeat(501))).length > 0);
  assert.equal(ok(parseNotes("a".repeat(500))), "a".repeat(500));
});
