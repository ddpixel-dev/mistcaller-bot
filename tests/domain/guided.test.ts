import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GUIDED_ROLES, back, canSave, emptyDraft, fillRest, isComplete, next, parseCount, sameAsPrevious, setCount, setDuty,
  setRole, setWeapon,
} from "../../src/domain/guided.ts";
import { parseSlots } from "../../src/domain/parse.ts";
import { formatSlotLines } from "../../src/domain/slots.ts";

const card = (d: ReturnType<typeof emptyDraft>, role: string, weapon: string, duty = "none") =>
  setDuty(setWeapon(setRole(d, role), weapon), duty);
const five = () => setCount(emptyDraft(), 5);

test("there are exactly four roles", () => {
  assert.deepEqual([...GUIDED_ROLES], ["Tank", "Healer", "Support", "DPS"]);
});

test("the count is a whole number from 1 to 20", () => {
  for (const [text, n] of [["1", 1], ["20", 20], [" 7 ", 7], ["05", 5]] as const) {
    assert.deepEqual(parseCount(text), { ok: true, value: n });
  }
  for (const bad of ["", "abc", "1.5", "-3", "2e1", "21", "100", "0", "00", "1000"]) assert.equal(parseCount(bad).ok, false, bad);
  assert.match((parseCount("0") as { error: string }).error, /At least 1/);
  assert.match((parseCount("21") as { error: string }).error, /maximum is 20/);
  assert.match((parseCount("x") as { error: string }).error, /whole number from 1 to 20/);
});

test("nothing can be chosen before the count is set", () => {
  const d = emptyDraft();
  assert.deepEqual(setRole(d, "Tank"), d);
  assert.deepEqual(setWeapon(d, "Mace"), d);
  assert.deepEqual(setDuty(d, "caller"), d);
  assert.deepEqual(next(d), d);
  assert.equal(setCount(d, 0).count, null);
  assert.equal(setCount(d, 21).count, null);
});

test("a card needs a role; the weapon and the duty are optional; Next saves it and moves on", () => {
  let d = five();
  assert.equal(canSave(d), false);
  d = setRole(d, "Tank");
  assert.equal(canSave(d), true, "a role alone is enough");
  assert.deepEqual(next(d).slots, [{ role: "Tank", weapon: "" }]);
  d = setWeapon(d, " Great Axe ");
  assert.equal(canSave(d), true);
  assert.deepEqual(next(emptyDraft()), emptyDraft());
  const saved = next(d);
  assert.deepEqual(saved.slots, [{ role: "Tank", weapon: "Great Axe" }]);
  assert.equal(saved.step, 1);
  assert.deepEqual([saved.role, saved.weapon, saved.duty], [null, null, null]);
  const withDuty = next(card(saved, "Healer", "Holy Staff", "caller"));
  assert.deepEqual(withDuty.slots[1], { role: "Healer", weapon: "Holy Staff", duty: "caller" });
});

test("bad choices are ignored: unknown role or duty, empty or long weapon; 'none' clears the duty", () => {
  const d = five();
  assert.deepEqual(setRole(d, "Wizard"), d);
  assert.deepEqual(setDuty(d, "captain"), d);
  assert.deepEqual(setWeapon(d, "   "), d);
  assert.deepEqual(setWeapon(d, "x".repeat(41)), d);
  assert.equal(setDuty(setDuty(d, "scout"), "none").duty, null);
});

test("the last Next completes the draft; nothing more can be chosen", () => {
  let d = setCount(emptyDraft(), 2);
  d = next(card(d, "Tank", "Mace"));
  assert.equal(isComplete(d), false);
  d = next(card(d, "DPS", "Bow", "rat"));
  assert.equal(isComplete(d), true);
  assert.deepEqual(d.slots.map((s) => s.duty ?? null), [null, "rat"]);
  assert.deepEqual(setRole(d, "Tank"), d);
  assert.deepEqual(next(d), d);
});

test("Back shows the previous card's saved choices and drops unsaved ones; not before the first card", () => {
  let d = next(card(five(), "Tank", "Mace", "caller"));
  d = card(d, "Healer", "Holy Staff");
  d = back(d);
  assert.equal(d.step, 0);
  assert.deepEqual([d.role, d.weapon, d.duty], ["Tank", "Mace", "caller"]);
  assert.deepEqual(back(d), d);
  d = next(setWeapon(d, "Great Axe"));
  assert.equal(d.step, 1);
  assert.deepEqual(d.slots[0], { role: "Tank", weapon: "Great Axe", duty: "caller" });
  assert.deepEqual([d.role, d.weapon], [null, null]);
});

test("going back and forward keeps the later saved slots and shows them", () => {
  let d = setCount(emptyDraft(), 3);
  d = next(card(d, "Tank", "A"));
  d = next(card(d, "Healer", "B", "scout"));
  d = back(back(d));
  d = next(d);
  assert.equal(d.step, 1);
  assert.deepEqual([d.role, d.weapon, d.duty], ["Healer", "B", "scout"]);
});

test("Same as previous puts the previous slot on this card, unsaved; needs a previous slot", () => {
  const first = five();
  assert.deepEqual(sameAsPrevious(first), first);
  const d = sameAsPrevious(next(card(first, "Tank", "Mace", "caller")));
  assert.deepEqual([d.role, d.weapon, d.duty], ["Tank", "Mace", "caller"]);
  assert.equal(d.slots.length, 1);
});

test("Fill the rest copies this card to this slot and all after it, and completes", () => {
  let d = next(card(five(), "Tank", "Mace"));
  d = fillRest(card(d, "DPS", "Bow", "rat"));
  assert.ok(isComplete(d));
  assert.equal(d.slots.length, 5);
  assert.deepEqual(d.slots[0], { role: "Tank", weapon: "Mace" });
  assert.ok(d.slots.slice(1).every((s) => s.role === "DPS" && s.weapon === "Bow" && s.duty === "rat"));
  assert.deepEqual(fillRest(five()), five());
});

test("a lower count trims the slots and caps the card; a higher one keeps them", () => {
  let d = setCount(emptyDraft(), 4);
  d = fillRest(card(d, "DPS", "Bow"));
  assert.equal(isComplete(d), true);
  assert.equal(setCount(d, 2).slots.length, 2);
  assert.equal(isComplete(setCount(d, 2)), true);
  const more = setCount(d, 6);
  assert.equal(more.slots.length, 4);
  assert.equal(more.step, 4);
  assert.equal(isComplete(more), false);
});

test("the finished slots become lines the normal parser accepts, including duties, up to 20", () => {
  let d = setCount(emptyDraft(), 20);
  d = fillRest(card(d, "Support", "Great Arcane Staff", "caller"));
  const lines = formatSlotLines(d.slots);
  assert.ok(lines.startsWith("Support - Great Arcane Staff (Caller)"));
  const parsed = parseSlots(lines);
  assert.equal(parsed.ok, true);
  assert.deepEqual((parsed as { value: unknown[] }).value[0], { role: "Support", weapon: "Great Arcane Staff", duty: "caller" });
  assert.equal((parsed as { value: unknown[] }).value.length, 20);
});
