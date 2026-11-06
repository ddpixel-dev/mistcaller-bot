import { test } from "node:test";
import assert from "node:assert/strict";
import { ANY_FILL, describeFill, fillMatches, parseFillValues, pickFillSlot, type FillPref } from "../../src/domain/fillmatch.ts";

const U1 = "11111111-1111-1111-1111-111111111111", U2 = "22222222-2222-2222-2222-222222222222";
const open = [
  { id: "t", position: 1, role: "Tank" },
  { id: "h1", position: 3, role: "Healer" },
  { id: "h2", position: 4, role: "Healer" },
  { id: "s", position: 5, role: "Support" },
  { id: "d1", position: 6, role: "DPS" },
  { id: "d2", position: 7, role: "DPS" },
];

test("Any takes a healer first, then Tank, DTank, Support, DPS", () => {
  assert.equal(pickFillSlot(ANY_FILL, open)!.id, "h1");
  assert.equal(pickFillSlot(ANY_FILL, open.filter((s) => s.role !== "Healer"))!.id, "t");
  assert.equal(pickFillSlot(ANY_FILL, open.filter((s) => !["Healer", "Tank"].includes(s.role)))!.id, "s");
  assert.equal(pickFillSlot(ANY_FILL, open.filter((s) => s.role === "DPS"))!.id, "d1");
  assert.equal(pickFillSlot(ANY_FILL, []), null);
});

test("chosen roles only match those roles, healers first, then the lowest position", () => {
  const pref: FillPref = { any: false, roles: ["dps", "Tank"], slotIds: [] };
  assert.equal(pickFillSlot(pref, open)!.id, "t");
  assert.equal(pickFillSlot(pref, open.filter((s) => s.role !== "Tank"))!.id, "d1");
  assert.equal(pickFillSlot({ any: false, roles: ["Healer", "DPS"], slotIds: [] }, open)!.id, "h1");
  assert.equal(pickFillSlot({ any: false, roles: ["Scout"], slotIds: [] }, open), null, "nothing matches");
});

test("chosen positions match only those slots, and mix with roles", () => {
  assert.equal(pickFillSlot({ any: false, roles: [], slotIds: ["d2"] }, open)!.id, "d2");
  assert.equal(pickFillSlot({ any: false, roles: [], slotIds: ["gone"] }, open), null);
  const mixed: FillPref = { any: false, roles: ["Tank"], slotIds: ["d2"] };
  assert.deepEqual(open.filter((s) => fillMatches(mixed, s)).map((s) => s.id), ["t", "d2"]);
  assert.equal(pickFillSlot({ any: false, roles: [], slotIds: ["h2", "h1"] }, open)!.id, "h1", "the lower position among equals");
});

test("menu values parse into a preference; Any wins; bad values are refused", () => {
  assert.deepEqual(parseFillValues(["any"]), ANY_FILL);
  assert.deepEqual(parseFillValues(["r:Healer", "s:" + U1, "any"]), ANY_FILL);
  assert.deepEqual(parseFillValues(["r:Healer", "r:Healer", `s:${U1}`, `s:${U2}`]), { any: false, roles: ["Healer"], slotIds: [U1, U2] });
  for (const bad of [[], ["x"], ["s:nope"], ["r:"], ["r:" + "a".repeat(101)], Array.from({ length: 26 }, (_, i) => `r:R${i}`), "any", [3]]) {
    assert.equal(parseFillValues(bad as unknown), null, JSON.stringify(bad));
  }
});

test("a preference reads back as text: Any, or the roles then the position numbers", () => {
  const pos = (id: string) => ({ [U1]: 7, [U2]: 3 })[id];
  assert.equal(describeFill(ANY_FILL, pos), "Any");
  assert.equal(describeFill({ any: false, roles: ["Healer", "Tank"], slotIds: [U1, U2] }, pos), "Healer, Tank, #3, #7");
  assert.equal(describeFill({ any: false, roles: [], slotIds: ["gone"] }, pos), "Any", "positions that no longer exist leave nothing chosen, which means Any");
});
