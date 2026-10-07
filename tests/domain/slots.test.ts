import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSlotLines, planSlotEdit } from "../../src/domain/slots.ts";
import type { RosterSlot } from "../../src/domain/types.ts";

const slots = (users: (string | null)[] = [null, null, null]): RosterSlot[] =>
  [["Tank", "Axe"], ["Healer", "Holy"], ["DPS", "Bow"]].map(([role, weapon], i) => ({
    id: `s${i + 1}`, position: i + 1, role: role!, weapon: weapon!, userId: users[i] ?? null,
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
