import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSlotLines, planSlotEdit } from "../../src/domain/slots.ts";
import type { RosterSlot } from "../../src/domain/types.ts";

const slots = (users: (string | null)[] = [null, null, null]): RosterSlot[] =>
  [["Tank", "Axe"], ["Healer", "Holy"], ["DPS", "Bow"]].map(([role, weapon], i) => ({
    id: `s${i + 1}`, position: i + 1, party: 1, role: role!, weapon: weapon!, userId: users[i] ?? null,
  }));
const def = (role: string, weapon: string) => ({ role, weapon });
const same = [def("Tank", "Axe"), def("Healer", "Holy"), def("DPS", "Bow")];

test("formatSlotLines round-trips the parser format", () => {
  assert.equal(formatSlotLines(same), "Tank - Axe\nHealer - Holy\nDPS - Bow");
});

test("unchanged lines produce an empty plan", () => {
  assert.deepEqual(planSlotEdit(slots(), same), { ok: true, value: { rename: [], add: [], remove: [] } });
});

test("a changed line renames that slot, even when held", () => {
  const r = planSlotEdit(slots(["a", null, null]), [def("Off-Tank", "Mace"), ...same.slice(1)]);
  assert.deepEqual(r, { ok: true, value: { rename: [{ id: "s1", role: "Off-Tank", weapon: "Mace", duty: null }], add: [], remove: [] } });
});

test("extra lines add slots", () => {
  const r = planSlotEdit(slots(), [...same, def("Scout", "Bow")]);
  assert.deepEqual(r, { ok: true, value: { rename: [], add: [def("Scout", "Bow")], remove: [] } });
});

test("dropping an empty trailing line removes it", () => {
  const r = planSlotEdit(slots(["a", null, null]), same.slice(0, 2));
  assert.deepEqual(r, { ok: true, value: { rename: [], add: [], remove: ["s3"] } });
});

test("dropping a held trailing line is refused and names the slot", () => {
  const r = planSlotEdit(slots([null, null, "c"]), same.slice(0, 2));
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /3\. DPS - Bow/);
});

test("a changed duty alone renames the slot, and the lines carry the duty in brackets", () => {
  const r = planSlotEdit(slots(), [{ ...same[0]!, duty: "caller" }, ...same.slice(1)]);
  assert.deepEqual(r, { ok: true, value: { rename: [{ id: "s1", role: "Tank", weapon: "Axe", duty: "caller" }], add: [], remove: [] } });
  assert.equal(formatSlotLines([{ role: "Tank", weapon: "Axe", duty: "caller" }, { role: "DPS", weapon: "Bow", duty: null }, { role: "DPS", weapon: "Bow", duty: "bogus" }]), "Tank - Axe (Caller)\nDPS - Bow\nDPS - Bow");
});

// FR-055: lines match slots by content, not by line number.
test("a line inserted in the middle adds an empty slot and leaves every holder's slot alone", () => {
  const r = planSlotEdit(slots(["a", "b", "c"]), [def("Tank", "Axe"), def("Healer", "Fallen"), def("Healer", "Holy"), def("DPS", "Bow")]);
  assert.deepEqual(r, { ok: true, value: { rename: [], add: [def("Healer", "Fallen")], remove: [] } });
});

test("a line inserted at the top adds an empty slot and renames nothing", () => {
  const r = planSlotEdit(slots(["a", "b", "c"]), [def("Scout", "Bow"), ...same]);
  assert.deepEqual(r, { ok: true, value: { rename: [], add: [def("Scout", "Bow")], remove: [] } });
});

test("removing a middle empty line removes that slot and leaves the others alone", () => {
  const r = planSlotEdit(slots(["a", null, "c"]), [same[0]!, same[2]!]);
  assert.deepEqual(r, { ok: true, value: { rename: [], add: [], remove: ["s2"] } });
});

test("with two identical lines, the empty one is the one removed", () => {
  const twin = [
    { id: "s1", position: 1, party: 1, role: "DPS", weapon: "Bow", userId: null },
    { id: "s2", position: 2, party: 1, role: "DPS", weapon: "Bow", userId: "b" },
  ];
  assert.deepEqual(planSlotEdit(twin, [def("DPS", "Bow")]), { ok: true, value: { rename: [], add: [], remove: ["s1"] } });
});

test("a changed line plus an inserted line: the change renames the slot of the same role", () => {
  const r = planSlotEdit(slots(["a", "b", "c"]), [def("Scout", "Bow"), same[0]!, def("Healer", "Fallen"), same[2]!]);
  assert.deepEqual(r, { ok: true, value: { rename: [{ id: "s2", role: "Healer", weapon: "Fallen", duty: null }], add: [def("Scout", "Bow")], remove: [] } });
});

// FR-076: weapon slots have no role; they are written back as `Weapon (Duty)` and matched by their weapon.
test("FR-076: formatSlotLines writes a weapon slot as its weapon and duty", () => {
  assert.equal(formatSlotLines([{ role: "", weapon: "Bow", duty: "scout" }, { role: "", weapon: "Hallowfall" }]), "Bow (Scout)\nHallowfall");
});

test("FR-076: planSlotEdit pairs weapon slots by their weapon", () => {
  const slot = (id: string, position: number, weapon: string, userId: string | null = null): RosterSlot => ({ id, position, party: 1, role: "", weapon, userId, duty: null });
  const r = planSlotEdit([slot("a", 1, "Mace", "u1"), slot("b", 2, "Bow")], [{ role: "", weapon: "Mace" }, { role: "", weapon: "Bow", duty: "scout" }]);
  assert.deepEqual(r, { ok: true, value: { rename: [{ id: "b", role: "", weapon: "Bow", duty: "scout" }], add: [], remove: [] } });
});
