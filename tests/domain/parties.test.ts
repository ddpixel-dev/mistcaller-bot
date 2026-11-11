import { test } from "node:test";
import assert from "node:assert/strict";
import { CTA_ROLES, displayNumber, MAX_PARTY_SLOTS, maxPartiesFor, parseCtaSlots, splitParty, withParty } from "../../src/domain/parties.ts";

test("constants", () => {
  assert.equal(MAX_PARTY_SLOTS, 20);
  assert.deepEqual([...CTA_ROLES], ["Tank", "DTank", "Healer", "Support", "DPS"]);
});

test("maxPartiesFor allows two parties only for a CTA", () => {
  assert.equal(maxPartiesFor("zvz", false), 1);
  assert.equal(maxPartiesFor("other", true), 2);
});

test("parseCtaSlots rejects a role outside the CTA roles", () => {
  const r = parseCtaSlots("Tank - Axe\nHeal", 1, 2);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'Party 1, line 2: "Heal" is not a supported role. Use Tank, DTank, Healer, Support or DPS.');
});

test("parseCtaSlots uses the original line number and a Line prefix for one party", () => {
  const r = parseCtaSlots("Tank\n\nHeal", 1, 1);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'Line 3: "Heal" is not a supported role. Use Tank, DTank, Healer, Support or DPS.');
  const r2 = parseCtaSlots("Tank\nDPS\nHeal", 2, 2);
  if (!r2.ok) assert.match(r2.error, /^Party 2, line 3: /);
});

test("parseCtaSlots accepts any case and a duty", () => {
  const r = parseCtaSlots("tank\nDPS - Bow (Caller)", 1, 1);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.length, 2);
    assert.equal(r.value[1]!.weapon, "Bow");
  }
});

test("parseCtaSlots allows 20 lines and rejects 21", () => {
  assert.equal(parseCtaSlots(Array(20).fill("DPS").join("\n"), 1, 1).ok, true);
  assert.equal(parseCtaSlots(Array(21).fill("DPS").join("\n"), 1, 1).ok, false);
});

test("splitParty reads the @2 suffix", () => {
  assert.deepEqual(splitParty("join:abc@2"), { id: "join:abc", party: 2 });
  assert.deepEqual(splitParty("join:abc@1"), { id: "join:abc", party: 1 });
  assert.deepEqual(splitParty("join:abc"), { id: "join:abc", party: 1 });
  for (const bad of ["join:abc@3", "join:abc@0", "join:abc@x", "join:abc@-1"]) assert.equal(splitParty(bad), null, bad);
});

test("withParty adds a suffix only for party 2", () => {
  assert.equal(withParty("join:abc", 1), "join:abc");
  assert.equal(withParty("join:abc", 2), "join:abc@2");
});

test("displayNumber restarts at 1 in each party", () => {
  const all = [1, 2, 3].map((p) => ({ party: 1, position: p })).concat([4, 5].map((p) => ({ party: 2, position: p })));
  assert.equal(displayNumber(all[0]!, all), 1);
  assert.equal(displayNumber(all[2]!, all), 3);
  assert.equal(displayNumber(all[3]!, all), 1);
  assert.equal(displayNumber(all[4]!, all), 2);
});
