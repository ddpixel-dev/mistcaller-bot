import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGearTier, parseSlots, parseUtcStart, parseTitle, parseNotes } from "../../src/domain/parse.ts";

function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  return (r as { ok: true; value: T }).value;
}
function err(r: { ok: boolean; error?: string }): string {
  assert.equal(r.ok, false);
  return r.error as string;
}

test("parseGearTier accepts any text and shows it as typed", () => {
  for (const s of ["T5.3", "T5.3-T7.0", "Weapon T7.1 - Gear T4.3", "Any gear, no mounts", "8.3 weapon / 6.0 armour", "Mixed 🛡️"]) {
    assert.equal(ok(parseGearTier(s)), s);
  }
});

test("parseGearTier trims, collapses spaces and line breaks, and strips control characters", () => {
  assert.equal(ok(parseGearTier("  Weapon   T7.1 \n Gear\tT4.3\u0007  ")), "Weapon T7.1 Gear T4.3");
});

test("parseGearTier refuses an empty or over-long text, and says what to type", () => {
  for (const s of ["", "   ", "\n\t"]) assert.ok(err(parseGearTier(s)).includes("Weapon T7.1 - Gear T4.3"), JSON.stringify(s));
  assert.equal(ok(parseGearTier("x".repeat(80))).length, 80);
  assert.ok(err(parseGearTier("x".repeat(81))).includes("80"));
});

test("parseSlots happy path", () => {
  assert.deepEqual(ok(parseSlots("Tank - Axe\nDPS-Longbow\n\nHealer – Holy")), [
    { role: "Tank", weapon: "Axe" },
    { role: "DPS", weapon: "Longbow" },
    { role: "Healer", weapon: "Holy" },
  ]);
  assert.deepEqual(ok(parseSlots("Tank - Great Axe")), [{ role: "Tank", weapon: "Great Axe" }]);
});

test("parseSlots accepts a role alone, with or without a duty (the weapon is the player's choice)", () => {
  assert.deepEqual(ok(parseSlots("Tank")), [{ role: "Tank", weapon: "" }]);
  assert.deepEqual(ok(parseSlots("Healer (Scout)\nDPS - Bow\nSupport -")), [
    { role: "Healer", weapon: "", duty: "scout" },
    { role: "DPS", weapon: "Bow" },
    { role: "Support", weapon: "" },
  ]);
  assert.ok(err(parseSlots("Tank (Captain)")).includes("Unknown duty"));
  assert.ok(err(parseSlots("a".repeat(31))).includes("too long"));
});

test("parseSlots errors", () => {
  assert.ok(err(parseSlots("Tank - Axe\n - Axe")).includes("line 2"));
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

test("parseSlots hyphenated roles and weapons", () => {
  assert.deepEqual(ok(parseSlots("Off-Tank - Axe")), [{ role: "Off-Tank", weapon: "Axe" }]);
  assert.deepEqual(ok(parseSlots("Off-Tank – Axe")), [{ role: "Off-Tank", weapon: "Axe" }]);
  assert.deepEqual(ok(parseSlots("DPS-Longbow")), [{ role: "DPS", weapon: "Longbow" }]);
  assert.deepEqual(ok(parseSlots("Tank - Great-Axe")), [{ role: "Tank", weapon: "Great-Axe" }]);
  assert.deepEqual(ok(parseSlots("Tank-Great Axe")), [{ role: "Tank", weapon: "Great Axe" }]);
  assert.ok(err(parseSlots("- Axe")).includes("needs a role"));
});

test("parseSlots CRLF and original line numbers", () => {
  assert.deepEqual(ok(parseSlots("Tank - Axe\r\nHealer - Holy\r\n")), [
    { role: "Tank", weapon: "Axe" },
    { role: "Healer", weapon: "Holy" },
  ]);
  assert.ok(err(parseSlots("Tank - Axe\n\n\n- Broken")).includes("line 4"));
});

test("parseUtcStart edge cases", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  assert.equal(ok(parseUtcStart("2028-02-29 18:00", now)).toISOString(), "2028-02-29T18:00:00.000Z");
  for (const s of ["2027-02-29 18:00", "2026-10-07 24:00", "2026-10-07 18:60"]) {
    assert.ok(err(parseUtcStart(s, now)).includes("2026-10-07 18:00"), s);
  }
});

test("zero-width only title and notes", () => {
  const zw = "​‌‍⁠﻿";
  assert.ok(err(parseTitle(` ${zw} `)).length > 0);
  assert.equal(ok(parseNotes(` ${zw} `)), null);
  assert.equal(ok(parseTitle(`${zw}Hi${zw}`)), "Hi");
});

test("parseSlots reads an optional duty in brackets at the end of a line", () => {
  const r = parseSlots("Tank - Great Axe (Caller)\nHealer - Holy Staff ( scout )\nDPS - Bow\nDPS - Dagger Pair (RAT)");
  assert.equal(r.ok, true);
  assert.deepEqual((r as { value: unknown[] }).value, [
    { role: "Tank", weapon: "Great Axe", duty: "caller" },
    { role: "Healer", weapon: "Holy Staff", duty: "scout" },
    { role: "DPS", weapon: "Bow" },
    { role: "DPS", weapon: "Dagger Pair", duty: "rat" },
  ]);
  const bad = parseSlots("Tank - Axe (Captain)");
  assert.equal(bad.ok, false);
  assert.match((bad as { error: string }).error, /Unknown duty "Captain" on line 1\. Use Caller, Scout, Rat, Looter\./);
  assert.deepEqual(ok(parseSlots("Tank - (Caller)")), [{ role: "Tank", weapon: "", duty: "caller" }]);
});

test("Looter is a duty, typed as (Looter) in any case", () => {
  const r = parseSlots("Support - Holy Staff (Looter)\nDPS - Bow ( looter )");
  assert.deepEqual((r as { ok: true; value: { duty?: string }[] }).value.map((s) => s.duty), ["looter", "looter"]);
});
