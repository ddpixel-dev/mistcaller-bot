import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalRole, canonicalWeapon, weaponHint } from "../../src/domain/terms.ts";
import { slotLabel, slotText } from "../../src/domain/slotlabel.ts";

// FR-077: five roles and the game's weapons, in any capitals; stored in the list's spelling.
test("canonicalRole accepts the five roles in any capitals and nothing else", () => {
  assert.deepEqual(["tank", " DTANK ", "Healer", "support", "dps"].map(canonicalRole), ["Tank", "DTank", "Healer", "Support", "DPS"]);
  for (const r of ["Off-Tank", "Scout", "Caller", "", "Tanky"]) assert.equal(canonicalRole(r), null, r);
});

test("canonicalWeapon accepts game names in any capitals, ignoring spaces, hyphens and apostrophes; off-hands included", () => {
  assert.equal(canonicalWeapon("hallowfall"), "Hallowfall");
  assert.equal(canonicalWeapon("Great Axe"), "Greataxe", "the game spells it Greataxe");
  assert.equal(canonicalWeapon("great holy staff"), "Great Holy Staff");
  assert.equal(canonicalWeapon("Torch"), "Torch", "an off-hand");
  for (const w of ["Holy", "Axe", "", "Grt Axe"]) assert.equal(canonicalWeapon(w), null, w);
});

test("weaponHint suggests up to three close names, or nothing", () => {
  assert.match(weaponHint("Grt Axe"), /^ Did you mean .*Greataxe/);
  assert.match(weaponHint("holy"), /Holy Staff/);
  assert.equal(weaponHint("zzzz"), "");
  assert.ok(weaponHint("staff").split(",").length <= 3);
});

// FR-076: one label per slot: its role, or its weapon when it has no role.
test("slotLabel is the role, or the weapon of a slot with no role; slotText is what menus show", () => {
  assert.equal(slotLabel({ role: "Tank", weapon: "Mace" }), "Tank");
  assert.equal(slotLabel({ role: "", weapon: "Bow" }), "Bow");
  assert.equal(slotText({ role: "Tank", weapon: "Mace", duty: "caller" }), "Tank - Mace");
  assert.equal(slotText({ role: "Tank", weapon: "" }), "Tank");
  assert.equal(slotText({ role: "", weapon: "Bow" }), "Bow");
});
