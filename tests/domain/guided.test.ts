import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GUIDED_ROLES, back, emptyDraft, fillRest, isComplete, nextRole, parseCounts, roleAt, sameAsPrevious, setCounts,
  setWeapon, total,
} from "../../src/domain/guided.ts";
import { parseSlots } from "../../src/domain/parse.ts";
import { formatSlotLines } from "../../src/domain/slots.ts";

const ok = (inputs: string[]) => {
  const r = parseCounts(inputs);
  assert.equal(r.ok, true);
  return (r as { value: number[] }).value;
};
const with2121 = () => setCounts(emptyDraft(), [2, 1, 2, 1]);

test("there are exactly four roles", () => {
  assert.deepEqual([...GUIDED_ROLES], ["Tank", "Healer", "Support", "DPS"]);
});

test("typed numbers: empty means zero, only whole numbers, at least 1 and at most 20 in total", () => {
  assert.deepEqual(ok(["1", "", " 2 ", "3"]), [1, 0, 2, 3]);
  assert.deepEqual(ok(["0", "0", "0", "1"]), [0, 0, 0, 1]);
  assert.deepEqual(ok(["5", "5", "5", "5"]), [5, 5, 5, 5]);
  for (const bad of [["a", "", "", ""], ["1.5", "", "", ""], ["-1", "", "", ""], ["100", "", "", ""], ["1e1", "", "", ""]]) {
    assert.equal(parseCounts(bad).ok, false, bad.join());
  }
  const none = parseCounts(["", "0", "", ""]);
  assert.equal(none.ok, false);
  assert.match((none as { error: string }).error, /at least one/);
  const many = parseCounts(["10", "5", "5", "1"]);
  assert.equal(many.ok, false);
  assert.match((many as { error: string }).error, /21 members/);
  assert.match((parseCounts(["", "x", "", ""]) as { error: string }).error, /Healer/);
});

test("the role of each slot follows the numbers: Tanks, then Healers, Support, DPS", () => {
  const d = with2121();
  assert.equal(total(d), 6);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => roleAt(d, i)), ["Tank", "Tank", "Healer", "Support", "Support", "DPS", null]);
  assert.equal(roleAt(emptyDraft(), 0), null);
});

test("a weapon makes the next slot with that slot's role; nothing works before the numbers are set", () => {
  assert.deepEqual(setWeapon(emptyDraft(), "Mace"), emptyDraft());
  const d = setWeapon(setWeapon(with2121(), "Mace"), " Great Axe ");
  assert.deepEqual(d.slots, [{ role: "Tank", weapon: "Mace" }, { role: "Tank", weapon: "Great Axe" }]);
  assert.equal(nextRole(d), "Healer");
  assert.deepEqual(setWeapon(with2121(), "   "), with2121());
  assert.deepEqual(setWeapon(with2121(), "x".repeat(41)), with2121());
});

test("same as previous reuses the last weapon for the next role and needs one slot first", () => {
  assert.deepEqual(sameAsPrevious(with2121()), with2121());
  const d = sameAsPrevious(setWeapon(with2121(), "Mace"));
  assert.deepEqual(d.slots, [{ role: "Tank", weapon: "Mace" }, { role: "Tank", weapon: "Mace" }]);
});

test("fill the rest completes every remaining slot with its role and the last weapon", () => {
  const d = fillRest(setWeapon(with2121(), "Bow"));
  assert.ok(isComplete(d));
  assert.deepEqual(d.slots.map((s) => s.role), ["Tank", "Tank", "Healer", "Support", "Support", "DPS"]);
  assert.ok(d.slots.every((s) => s.weapon === "Bow"));
  assert.deepEqual(fillRest(with2121()).slots, []);
  assert.deepEqual(setWeapon(d, "Mace"), d);
  assert.deepEqual(sameAsPrevious(d), d);
});

test("back removes the last slot", () => {
  const d = back(setWeapon(setWeapon(with2121(), "A"), "B"));
  assert.deepEqual(d.slots, [{ role: "Tank", weapon: "A" }]);
  assert.deepEqual(back(emptyDraft()), emptyDraft());
});

test("new numbers start the slots over; the same numbers keep them", () => {
  const d = setWeapon(with2121(), "Mace");
  assert.deepEqual(setCounts(d, [2, 1, 2, 1]), d);
  assert.deepEqual(setCounts(d, [1, 1, 1, 1]), { counts: [1, 1, 1, 1], slots: [] });
});

test("the finished draft becomes lines the normal parser accepts, up to 20 slots", () => {
  const d = fillRest(setWeapon(setCounts(emptyDraft(), [2, 3, 3, 12]), "Great Axe"));
  assert.equal(total(d), 20);
  const parsed = parseSlots(formatSlotLines(d.slots));
  assert.equal(parsed.ok, true);
  assert.equal((parsed as { value: unknown[] }).value.length, 20);
});
