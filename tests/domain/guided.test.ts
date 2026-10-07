import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GUIDED_ROLES, MAX_SLOTS, back, emptyDraft, fillRest, isComplete, sameAsPrevious, setCount, setRole, setWeapon,
} from "../../src/domain/guided.ts";
import { parseSlots } from "../../src/domain/parse.ts";
import { formatSlotLines } from "../../src/domain/slots.ts";

const three = () => setCount(emptyDraft(), 3);

test("count must be 1 to 20; nothing else works before a count is set", () => {
  assert.equal(setCount(emptyDraft(), 0).count, null);
  assert.equal(setCount(emptyDraft(), 21).count, null);
  assert.equal(setCount(emptyDraft(), 2.5).count, null);
  assert.equal(setCount(emptyDraft(), MAX_SLOTS).count, 20);
  assert.deepEqual(setRole(emptyDraft(), "Tank"), emptyDraft());
  assert.deepEqual(setWeapon(emptyDraft(), "Mace"), emptyDraft());
});

test("a role and a weapon, in either order, make one slot", () => {
  let d = setWeapon(setRole(three(), "Tank"), "Mace");
  assert.deepEqual(d.slots, [{ role: "Tank", weapon: "Mace" }]);
  assert.equal(d.role, null);
  d = setRole(setWeapon(d, "Holy Staff"), "Healer");
  assert.deepEqual(d.slots.map((s) => s.role), ["Tank", "Healer"]);
});

test("one half alone waits; unknown roles and bad weapons are ignored", () => {
  let d = setRole(three(), "Tank");
  assert.equal(d.slots.length, 0);
  assert.equal(d.role, "Tank");
  assert.equal(setRole(three(), "Wizard").role, null);
  assert.equal(setWeapon(three(), "   ").weapon, null);
  assert.equal(setWeapon(three(), "x".repeat(41)).weapon, null);
  d = setWeapon(d, "  Mace ");
  assert.deepEqual(d.slots, [{ role: "Tank", weapon: "Mace" }]);
});

test("same as previous copies the last slot and needs one to exist", () => {
  assert.deepEqual(sameAsPrevious(three()), three());
  const d = sameAsPrevious(setWeapon(setRole(three(), "DPS"), "Bow"));
  assert.deepEqual(d.slots, [{ role: "DPS", weapon: "Bow" }, { role: "DPS", weapon: "Bow" }]);
});

test("fill the rest copies the last slot to every remaining position and completes", () => {
  const d = fillRest(setWeapon(setRole(setCount(emptyDraft(), 5), "DPS"), "Bow"));
  assert.equal(d.slots.length, 5);
  assert.ok(isComplete(d));
  assert.deepEqual(fillRest(setCount(emptyDraft(), 5)).slots, []);
  assert.deepEqual(sameAsPrevious(d), d);
  assert.deepEqual(setRole(d, "Tank"), d);
});

test("back clears a half-chosen slot first, then removes the last finished one", () => {
  let d = setWeapon(setRole(three(), "Tank"), "Mace");
  d = setRole(d, "Healer");
  d = back(d);
  assert.equal(d.role, null);
  assert.equal(d.slots.length, 1);
  assert.equal(back(d).slots.length, 0);
  assert.equal(back(emptyDraft()).slots.length, 0);
});

test("lowering the count trims extra slots; raising it keeps them", () => {
  const d = fillRest(setWeapon(setRole(setCount(emptyDraft(), 4), "DPS"), "Bow"));
  assert.equal(setCount(d, 2).slots.length, 2);
  assert.equal(setCount(d, 6).slots.length, 4);
  assert.equal(isComplete(setCount(d, 6)), false);
});

test("the finished draft becomes lines the normal parser accepts, up to 20 slots", () => {
  const d = fillRest(setWeapon(setRole(setCount(emptyDraft(), 20), "Off-Tank"), "Great Axe"));
  const parsed = parseSlots(formatSlotLines(d.slots));
  assert.equal(parsed.ok, true);
  assert.equal((parsed as { value: unknown[] }).value.length, 20);
});

test("every guided role is short enough for a slot line", () => {
  for (const r of GUIDED_ROLES) assert.ok(r.length <= 30);
});
